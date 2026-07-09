---
titre: Stripe Checkout & Payment Links
cours: 22-stripe-billing
notions:
  - "Checkout Session (page de paiement hébergée par Stripe)"
  - "mode: payment vs subscription vs setup"
  - success_url et cancel_url
  - "placeholder {CHECKOUT_SESSION_ID}"
  - line_items (price + quantity)
  - client_reference_id
  - metadata
  - Payment Links (no-code vs API)
  - "pourquoi Checkout > formulaire de carte maison (PCI)"
outcomes:
  - sait créer une Checkout Session depuis NestJS et rediriger le client vers l'URL hébergée
  - "sait choisir mode: payment ou subscription selon le type de vente"
  - sait relier une session à un utilisateur via client_reference_id / metadata
  - sait quand préférer un Payment Link no-code à une Checkout Session codée
prerequis: [00-introduction-au-billing-saas, 01-stripe-products-et-prices]
next: 03-webhooks-et-idempotence
libs: [{ name: stripe, version: "^17" }]
tribuzen: back-office TribuZen — endpoint qui crée la Checkout Session d'upgrade vers TribuZen Premium
last-reviewed: 2026-07
---

# Stripe Checkout & Payment Links

> **Outcomes — tu sauras FAIRE :** créer une Checkout Session depuis NestJS, choisir le bon `mode`, relier la session à ton utilisateur, et savoir quand un Payment Link no-code suffit.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre la **création** de la session et la redirection. La **confirmation fiable** du paiement (ne jamais se fier au `success_url`, écouter les webhooks signés) est le sujet du **module 03**.

## 1. Cas concret d'abord

Un parent utilise TribuZen en plan gratuit. Il clique sur « Passer à Premium » depuis la page d'upgrade. Tu dois maintenant lui présenter un paiement récurrent de 4,90 €/mois.

La tentation du débutant : construire un formulaire de carte dans le front, appeler l'API Stripe avec le numéro de carte, gérer soi-même la validation, la 3DS, les erreurs…

```ts
// ❌ Ce que tu NE dois PAS faire
async function payer(numeroCarte: string, cvc: string) {
  // Tu manipules le numéro de carte → tu tombes sous la conformité PCI-DSS
  // complète (SAQ D), audits, responsabilité en cas de fuite. Pour un MVP,
  // c'est disqualifiant.
}
```

La bonne réponse : tu ne touches **jamais** le numéro de carte. Tu demandes à Stripe de créer une **Checkout Session** — une page de paiement **hébergée par Stripe** — et tu rediriges l'utilisateur dessus. Stripe encaisse, gère la 3DS, la conformité PCI, les moyens de paiement locaux, puis te renvoie l'utilisateur.

À la fin de ce module, tu écris l'endpoint NestJS qui crée cette session pour TribuZen Premium.

---

## 2. Théorie complète, concise

### 2.1 Qu'est-ce qu'une Checkout Session

Une **Checkout Session** est un objet Stripe qui représente une intention de paiement présentée sur une **page hébergée par Stripe**. Tu la crées côté serveur, Stripe te renvoie une `url`, tu rediriges l'utilisateur vers cette URL.

Le flux complet :

```
1. Front : clic "Passer à Premium"          → POST /billing/checkout (ton API)
2. Ton API : stripe.checkout.sessions.create({...})  → renvoie session.url
3. Ton API : renvoie { url } au front
4. Front : window.location.href = url        → redirection vers Stripe
5. Stripe : affiche la page de paiement, encaisse la carte, gère la 3DS
6. Stripe : redirige vers success_url (paiement OK) ou cancel_url (abandon)
```

La création se fait **toujours côté serveur** (clé secrète `sk_...`), jamais dans le navigateur.

### 2.2 Le paramètre `mode` — trois valeurs

`mode` est **obligatoire** et détermine la nature de la vente. Trois valeurs acceptées :

| `mode` | Usage | Exemple TribuZen |
|--------|-------|------------------|
| `payment` | Paiement unique | Livre famille annuel à 25 € |
| `subscription` | Abonnement récurrent | TribuZen Premium à 4,90 €/mois |
| `setup` | Enregistrer une carte sans débiter tout de suite | Ajouter un moyen de paiement pour plus tard |

Pour TribuZen Premium (récurrent), c'est `mode: 'subscription'`. Un Price `recurring` (vu au module 01) **exige** `mode: 'subscription'` — un Price `one_time` exige `mode: 'payment'`. Se tromper de couple `mode`/`price` renvoie une erreur Stripe.

### 2.3 `line_items` — ce qu'on vend

`line_items` est le tableau des lignes à facturer. Chaque ligne référence un **Price** (créé au module 01) et une **quantité** :

```ts
line_items: [
  { price: 'price_1PremiumMonthly', quantity: 1 },
]
```

On passe l'**ID du Price**, jamais un montant en dur. Le montant, la devise et la récurrence vivent dans le Price côté Stripe. En `mode: 'subscription'`, la quantité doit valoir 1 pour un abonnement simple (la quantité sert aux abonnements par siège, ex. « 5 utilisateurs »).

### 2.4 `success_url` et `cancel_url`

Ce sont les deux URL de retour :

- `success_url` : où Stripe renvoie l'utilisateur **après un paiement réussi**.
- `cancel_url` : où Stripe le renvoie s'il **abandonne** (bouton retour de la page Stripe).

Stripe expose un placeholder spécial : <code v-pre>{CHECKOUT_SESSION_ID}</code>. Tu l'écris littéralement dans `success_url` et Stripe le **remplace** par l'ID réel de la session au moment de la redirection :

```ts
success_url: 'https://app.tribuzen.fr/premium/merci?session_id={CHECKOUT_SESSION_ID}',
// Après paiement, l'utilisateur arrive sur :
// https://app.tribuzen.fr/premium/merci?session_id=cs_test_a1b2c3...
```

> ⚠️ **Le `success_url` n'est PAS une preuve de paiement.** Un utilisateur peut atterrir dessus sans avoir payé (fermeture d'onglet, réseau, URL devinée). La confirmation fiable passe par les **webhooks** signés — c'est tout le module 03. Ici, `success_url` sert uniquement à l'expérience utilisateur (page « merci »).

### 2.5 Relier la session à ton utilisateur : `client_reference_id` et `metadata`

Quand le webhook `checkout.session.completed` arrivera (module 03), tu dois savoir **quel utilisateur TribuZen** vient de payer. Deux mécanismes :

- **`client_reference_id`** : une chaîne libre (max 200 caractères), pensée pour la réconciliation. Idéale pour l'ID de ton utilisateur.
- **`metadata`** : un objet clé-valeur libre, pour tout contexte supplémentaire (plan choisi, campagne, etc.).

```ts
client_reference_id: user.id,                 // qui paie
metadata: { plan: 'premium', source: 'upgrade_page' },  // contexte
```

Sans ça, tu reçois une confirmation de paiement anonyme et tu ne sais pas à qui appliquer le plan Premium.

> **`customer` vs `client_reference_id`** : si tu as déjà créé un Customer Stripe pour l'utilisateur (module 01), passe aussi `customer: user.stripeCustomerId`. Le Customer relie durablement l'abonnement à une identité Stripe ; `client_reference_id` est ta clé de réconciliation côté TribuZen. Les deux sont complémentaires.

### 2.6 Payment Links — l'alternative no-code

Un **Payment Link** est une page de paiement hébergée Stripe, mais **réutilisable** et **créée sans code**, généralement depuis le [dashboard Stripe](https://dashboard.stripe.com/payment-links). Tu obtiens une URL du type `https://buy.stripe.com/...` que tu partages (email, réseaux, QR code, bouton). Un Payment Link peut aussi vendre un abonnement.

Il existe aussi une API (`stripe.paymentLinks.create`) pour les créer par programme, mais l'intérêt principal est justement le **no-code**.

**Checkout Session vs Payment Link :**

| | Checkout Session | Payment Link |
|---|---|---|
| Création | Par code, côté serveur | No-code (dashboard) ou API |
| Cible | Un utilisateur précis (session à usage unique) | N'importe qui avec le lien (réutilisable) |
| Personnalisation par utilisateur | Forte (`client_reference_id`, `metadata`, `customer`) | Limitée |
| Cas TribuZen | Upgrade in-app d'un utilisateur connecté | Offre partagée (post LinkedIn, campagne) |

Règle : pour un **upgrade in-app** où tu connais l'utilisateur connecté et veux le retrouver au webhook → **Checkout Session**. Pour une **offre générique** partagée à froid → **Payment Link** suffit.

### 2.7 Pourquoi Checkout plutôt qu'une intégration maison

- **PCI-DSS** : le numéro de carte ne transite jamais par ton serveur → tu restes sur le niveau de conformité le plus léger (SAQ A). Une intégration maison qui touche la carte t'impose des audits lourds.
- **3D Secure / SCA** : Stripe gère l'authentification forte (obligatoire en Europe, DSP2) pour toi.
- **Moyens de paiement locaux** : cartes, wallets, virements… activables sans code supplémentaire.
- **Maintenance** : Stripe met à jour la page, les traductions, les nouveaux moyens de paiement.

Pour un MVP comme TribuZen, coder soi-même le formulaire de carte est un anti-pattern : plus de risque, plus de charge, aucune valeur ajoutée.

---

## 3. Worked examples

### Exemple 1 — Endpoint NestJS d'upgrade vers TribuZen Premium

On crée la Checkout Session `subscription` pour un utilisateur connecté.

```ts
// src/billing/billing.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { User } from '../users/user.entity';

@Injectable()
export class BillingService {
  constructor(
    @Inject('STRIPE_CLIENT') private readonly stripe: Stripe,
    private readonly config: ConfigService,
  ) {}

  async createPremiumCheckout(user: User): Promise<string> {
    const appUrl = this.config.get<string>('APP_URL'); // ex. https://app.tribuzen.fr

    const session = await this.stripe.checkout.sessions.create({
      // Abonnement récurrent → mode subscription (Price recurring)
      mode: 'subscription',

      // On facture le Price Premium mensuel (ID stocké en .env, jamais en dur)
      line_items: [
        { price: this.config.get<string>('STRIPE_PRICE_PREMIUM_MONTHLY'), quantity: 1 },
      ],

      // Relie la session à un Customer Stripe existant (créé à l'inscription)
      customer: user.stripeCustomerId,

      // Clés de réconciliation pour le webhook checkout.session.completed (module 03)
      client_reference_id: user.id,
      metadata: { plan: 'premium', source: 'upgrade_page' },

      // URLs de retour — success_url reçoit l'ID de session (usage UI uniquement)
      success_url: `${appUrl}/premium/merci?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/premium`,
    });

    // session.url = page de paiement hébergée par Stripe
    return session.url;
  }
}
```

```ts
// src/billing/billing.controller.ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import { BillingService } from './billing.service';

@Controller('billing')
@UseGuards(JwtAuthGuard) // seul un utilisateur connecté peut lancer un upgrade
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('checkout')
  async createCheckout(@CurrentUser() user: User): Promise<{ url: string }> {
    const url = await this.billing.createPremiumCheckout(user);
    return { url }; // le front fait window.location.href = url
  }
}
```

Le front n'a plus qu'à rediriger :

```ts
// Côté front — page d'upgrade TribuZen
async function upgradeToPremium() {
  const res = await fetch('/api/billing/checkout', { method: 'POST' });
  const { url } = await res.json();
  window.location.href = url; // → page hébergée Stripe
}
```

Pour tester, sur la page Stripe, utilise la carte de test `4242 4242 4242 4242`, une date future et n'importe quel CVC.

### Exemple 2 — Paiement unique (mode payment) pour le livre annuel

Même API, `mode: 'payment'` avec un Price `one_time` :

```ts
async function createBookCheckout(user: User): Promise<string> {
  const appUrl = this.config.get<string>('APP_URL');

  const session = await this.stripe.checkout.sessions.create({
    mode: 'payment', // paiement unique, PAS subscription
    line_items: [
      { price: this.config.get<string>('STRIPE_PRICE_LIVRE_ANNUEL'), quantity: 1 },
    ],
    client_reference_id: user.id,
    metadata: { produit: 'livre_annuel' },
    success_url: `${appUrl}/livre/merci?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/livre`,
  });

  return session.url;
}
```

La seule différence structurante avec l'Exemple 1 est le couple `mode`/type de Price. Le reste du flux (redirection, webhook) est identique.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Se fier au `success_url` pour débloquer Premium

```ts
// ❌ Débloquer le plan parce que l'utilisateur est arrivé sur /merci
// → contournable, faux positifs (onglet fermé avant paiement, URL devinée)

// ✅ Débloquer UNIQUEMENT sur le webhook checkout.session.completed signé (module 03)
```

`success_url` est de l'UX, pas une preuve d'encaissement. C'est l'erreur la plus grave du module — elle ouvre une faille d'accès gratuit.

### PIÈGE #2 — Mauvais couple `mode` / type de Price

```ts
// ❌ Price recurring avec mode payment → erreur Stripe
mode: 'payment',
line_items: [{ price: 'price_premium_monthly' /* recurring ! */, quantity: 1 }],

// ✅ Price recurring → mode subscription
mode: 'subscription',
line_items: [{ price: 'price_premium_monthly', quantity: 1 }],
```

Un Price `recurring` impose `subscription` ; un Price `one_time` impose `payment`.

### PIÈGE #3 — Créer la session côté navigateur

```ts
// ❌ stripe.checkout.sessions.create appelé depuis le front
// → il faudrait exposer la clé secrète sk_... au client. JAMAIS.

// ✅ Création côté serveur (NestJS), le front ne reçoit que session.url
```

La clé secrète reste serveur. Le front ne manipule que l'URL renvoyée.

### PIÈGE #4 — Oublier la clé de réconciliation

```ts
// ❌ Aucun client_reference_id ni metadata
// → au webhook, tu sais qu'un paiement a eu lieu mais pas POUR QUI

// ✅ client_reference_id: user.id (+ metadata de contexte)
```

Sans identifiant, impossible d'appliquer Premium au bon compte TribuZen.

### PIÈGE #5 — Écrire le montant en dur dans `line_items`

```ts
// ❌ line_items: [{ price_data: { unit_amount: 490, ... }, quantity: 1 }]
//    à chaque appel → prix dispersés dans le code, incohérences

// ✅ line_items: [{ price: 'price_...', quantity: 1 }]
//    le prix vit dans le Price Stripe (module 01), référencé par ID en .env
```

Centraliser le tarif dans le Price Stripe garde une source de vérité unique.

---

## 5. Ancrage TribuZen

La **page d'upgrade vers Premium** est le point d'entrée monétisation de TribuZen. Un parent en plan gratuit clique « Passer à Premium » → le front appelle `POST /billing/checkout` → l'endpoint de l'Exemple 1 crée la Checkout Session `subscription` → redirection vers Stripe → retour sur `/premium/merci`.

Le `client_reference_id = user.id` et le `customer = user.stripeCustomerId` sont les fils qui, au module 03, permettront au webhook `checkout.session.completed` de faire passer **ce** parent en `tier: 'premium'`.

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen/
  src/
    billing/
      billing.controller.ts   ← POST /billing/checkout (guardé JWT)
      billing.service.ts       ← createPremiumCheckout (Exemple 1)
```

Le **Payment Link no-code** servira ailleurs : une offre de lancement Premium partagée dans un post LinkedIn, sans passer par l'app.

---

## 6. Points clés

1. Une Checkout Session est une page de paiement **hébergée par Stripe** ; tu la crées côté serveur et rediriges vers `session.url`.
2. `mode` vaut `payment` (unique), `subscription` (récurrent) ou `setup` (enregistrer une carte) — il doit matcher le type du Price.
3. `line_items` référence un **Price par son ID**, jamais un montant en dur.
4. `success_url` / `cancel_url` sont les retours ; <code v-pre>{CHECKOUT_SESSION_ID}</code> y est remplacé par Stripe.
5. `success_url` n'est **pas** une preuve de paiement — la confirmation fiable est le webhook (module 03).
6. `client_reference_id` (+ `metadata`, `customer`) relie la session à ton utilisateur TribuZen pour la réconciliation.
7. Un **Payment Link** no-code convient à une offre partagée à froid ; une **Checkout Session** convient à un upgrade in-app personnalisé.
8. Checkout > formulaire maison : PCI (SAQ A), 3DS/SCA, moyens de paiement et maintenance délégués à Stripe.

---

## 7. Seeds Anki

```
Qu'est-ce qu'une Checkout Session Stripe ?|Une page de paiement hébergée par Stripe, créée côté serveur ; on récupère session.url et on y redirige l'utilisateur. Stripe encaisse et gère la conformité PCI/3DS.
Quelles sont les 3 valeurs de mode dans une Checkout Session ?|payment (paiement unique), subscription (abonnement récurrent), setup (enregistrer une carte sans débiter). mode doit correspondre au type du Price.
Que met-on dans line_items d'une Checkout Session ?|Un tableau { price: 'price_...', quantity } référençant un Price par son ID — jamais un montant en dur. Le montant vit dans le Price Stripe.
Pourquoi ne faut-il jamais débloquer un plan sur le success_url ?|Parce que success_url est de l'UX, pas une preuve de paiement : atteignable sans avoir payé. La confirmation fiable passe par le webhook checkout.session.completed signé (module 03).
À quoi sert {CHECKOUT_SESSION_ID} dans success_url ?|C'est un placeholder que Stripe remplace par l'ID réel de la session lors de la redirection, ex. ?session_id=cs_test_... — utile pour l'UI côté retour.
Comment relier une Checkout Session à un utilisateur TribuZen ?|Via client_reference_id (ex. user.id, max 200 car.) et/ou metadata, éventuellement customer (Customer Stripe). Le webhook les relit pour savoir qui a payé.
Checkout Session ou Payment Link : lequel pour un upgrade in-app connecté ?|Checkout Session — session à usage unique, personnalisable par utilisateur (client_reference_id/metadata). Le Payment Link no-code sert aux offres génériques partagées à froid.
Pourquoi préférer Stripe Checkout à un formulaire de carte maison ?|Le numéro de carte ne transite jamais par ton serveur (PCI SAQ A), Stripe gère 3DS/SCA, moyens de paiement locaux et maintenance. Coder soi-même = risque et charge sans valeur.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-02-stripe-checkout-et-payment-links/README.md`. Écrire l'endpoint NestJS qui crée la Checkout Session d'upgrade TribuZen Premium et le tester avec la carte `4242 4242 4242 4242` — vrai SDK Stripe en mode test, corrigé commenté intégral.
