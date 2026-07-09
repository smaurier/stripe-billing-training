---
titre: Customer Portal et self-service
cours: 22-stripe-billing
notions: ["Billing Customer Portal", "billingPortal.sessions.create", "customer (cus_...) requis", "return_url", "configuration du portail", "features", "annulation at end of period vs immédiate", "cancellation_reason", "conformité PCI/RGPD déléguée", "réduire le support"]
outcomes:
  - sait ouvrir une session de Customer Portal depuis NestJS avec billingPortal.sessions.create et rediriger le client
  - sait expliquer ce que le client fait seul dans le portail (changer de plan, moyen de paiement, annuler, télécharger ses factures)
  - sait configurer le portail dans le Dashboard (features activées, annulation en fin de période, return_url par défaut)
  - sait pourquoi le portail réduit le support et délègue la conformité PCI/RGPD à Stripe
prerequis: ["00-introduction-au-billing-saas", "01-stripe-products-et-prices", "02-stripe-checkout-et-payment-links", "03-webhooks-et-idempotence", "04-subscriptions-et-cycle-de-vie"]
next: 06-freemium-et-feature-gating
libs: [{ name: stripe, version: "^17" }]
tribuzen: billing TribuZen Premium — la famille gère son abonnement (plan, carte, annulation, factures) sans jamais contacter le support, via le Customer Portal hébergé par Stripe
last-reviewed: 2026-07
---

# Customer Portal et self-service

> **Outcomes — tu sauras FAIRE :** ouvrir une session de Customer Portal depuis NestJS et y rediriger le client, expliquer ce qu'il gère seul (plan, carte, annulation, factures), configurer le portail dans le Dashboard, et comprendre pourquoi il réduit le support et délègue la conformité PCI/RGPD.
> **Difficulté :** :star::star:

## 1. Cas concret d'abord

Une famille sur **TribuZen Premium** veut passer de l'abonnement mensuel à l'annuel, et met à jour sa carte bancaire qui vient d'expirer. Une autre veut télécharger la facture de janvier pour ses comptes. Une troisième veut annuler.

Sans outil, chacune de ces demandes atterrit dans ta boîte support. Et pire : la tentation est d'écrire toi-même un écran « changer de plan », un formulaire « nouvelle carte », une page « mes factures ». Chacun de ces écrans manipule des données de paiement — donc chacun te fait entrer dans le périmètre **PCI-DSS**, avec un formulaire carte à sécuriser, une conformité à auditer, des factures légales à générer.

```txt
❌ Réflexe coûteux : recoder soi-même
   - écran "changer de plan"      → logique de proration à réimplémenter (module 04)
   - formulaire "nouvelle carte"  → tu touches des numéros de carte → périmètre PCI
   - page "mes factures"          → génération/archivage légal des factures
   → des semaines de dev + un risque de conformité, pour un problème déjà résolu
```

Stripe fournit une page **hébergée chez lui**, le **Billing Customer Portal**, qui fait déjà tout ça : changement de plan avec proration, mise à jour du moyen de paiement, annulation, historique des factures — en conformité PCI et RGPD, sans qu'un seul numéro de carte transite par ton serveur.

Côté TribuZen, ton travail se réduit à **une chose** : un endpoint NestJS qui ouvre une session de portail pour le client connecté et le redirige. C'est l'objet de ce module.

---

## 2. Théorie complète, concise

### 2.1 Qu'est-ce que le Customer Portal

Le **Billing Customer Portal** est une page **hébergée par Stripe** (comme Checkout au module 02, mais pour l'après-vente). Tu ne construis aucune UI de gestion d'abonnement : tu envoies le client vers une URL Stripe, il gère son compte, puis il revient chez toi.

C'est le pendant « self-service » de tout ce que tu as appris au module 04 : là tu pilotais le cycle de vie *par API* (upgrade, annulation, proration) ; ici, **c'est le client lui-même** qui déclenche ces mêmes opérations via une interface prête à l'emploi. Les changements qu'il fait dans le portail arrivent chez toi comme d'habitude : sous forme de **webhooks** `customer.subscription.*` (module 03). Le portail ne court-circuite rien — il déclenche les mêmes events.

### 2.2 Ce que le client fait seul

Selon la configuration que tu actives, le client peut, sans toi :

| Action | Feature Stripe | Ce que ça déclenche |
|---|---|---|
| Changer de plan (mensuel ↔ annuel, Free ↔ Premium) | `subscription_update` | `customer.subscription.updated` (+ proration, module 04) |
| Ajouter / changer / supprimer un moyen de paiement | `payment_method_update` | mise à jour du moyen de paiement par défaut |
| Annuler l'abonnement | `subscription_cancel` | `customer.subscription.updated` puis `.deleted` en fin de période |
| Consulter et télécharger ses factures | `invoice_history` | rien côté abonnement (lecture seule) |
| Renseigner / modifier un numéro de TVA | `tax_id` (si Stripe Tax) | mise à jour du client |

> **⚠️ Ne route que des noms d'events vérifiés.** Les noms de features ci-dessus (`subscription_update`, `subscription_cancel`, `payment_method_update`, `invoice_history`) et les events (`customer.subscription.updated/deleted`) sont ceux de la doc Stripe courante. Vérifie sur `docs.stripe.com` avant d'ajouter un `case` dans ton handler webhook.

### 2.3 Ouvrir une session de portail

Une **session de portail** est un lien à usage court, propre à un client. On la crée avec :

```ts
const session = await stripe.billingPortal.sessions.create({
  customer: 'cus_...',                    // REQUIS — le Customer Stripe du client
  return_url: 'https://app.tribuzen.fr/parametres/abonnement',
});
// session.url → l'URL hébergée Stripe vers laquelle rediriger
```

Deux paramètres à connaître :

- **`customer`** *(requis)* — l'identifiant `cus_...` du client. C'est le `stripeCustomerId` que tu as rattaché à l'utilisateur au module 03 (`checkout.session.completed`). Sans lui, pas de session.
- **`return_url`** — l'URL de retour quand le client ferme le portail. Requise **sauf** si tu as défini une URL de retour par défaut dans le Dashboard. Elle sert uniquement à ramener le client dans ton app (UX), rien de plus.
- **`configuration`** *(optionnel)* — pour appliquer une configuration de portail précise à la session (utile si tu en as plusieurs).

`session.url` est l'URL vers laquelle tu rediriges. Elle est **à usage unique et expire** : on la crée à la demande, on ne la stocke jamais.

### 2.4 Configurer le portail (Dashboard vs API)

Avant qu'une session fonctionne, il faut **activer et configurer** le portail. Deux voies :

**Dashboard** (recommandé pour démarrer) — `Settings → Billing → Customer portal` (`dashboard.stripe.com/settings/billing/portal`) :

```txt
Features à activer pour TribuZen Premium :
  [x] Customers can update subscriptions   (subscription_update)
        → produits/prix autorisés : plans TribuZen Premium mensuel + annuel
  [x] Customers can cancel subscriptions   (subscription_cancel)
        → mode d'annulation : "at end of billing period"   (⟵ recommandé)
        → cancellation reason : activé  (comprendre le churn)
  [x] Customers can update payment methods (payment_method_update)
  [x] Invoice history                      (invoice_history)
  Default return URL : https://app.tribuzen.fr/parametres/abonnement
```

**API** — même chose via `stripe.billingPortal.configurations.create({ features: { ... } })`, utile pour versionner la config dans le code ou avoir plusieurs configurations. Exemple minimal :

```ts
await stripe.billingPortal.configurations.create({
  features: {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end' },
  },
});
```

> **Annulation : `at_period_end`, pas immédiate.** En fin de période, le client garde Premium jusqu'au terme déjà payé — cohérent avec la logique du module 04 (`cancel_at_period_end`) et moins frustrant. L'annulation immédiate coupe l'accès sur-le-champ et n'a de sens que dans des cas particuliers.

### 2.5 Pourquoi ça réduit le support et sécurise la conformité

- **Support divisé.** « Changez mon plan / ma carte / téléchargez ma facture / annulez » — ces demandes ne t'atteignent plus, le client se sert seul, 24/7.
- **Zéro écran de paiement à maintenir.** Pas de formulaire carte, pas de page factures à coder, tester, traduire, rendre accessible.
- **Conformité déléguée.** Aucun numéro de carte ne transite par ton serveur → tu restes hors du périmètre PCI le plus lourd. Les factures et leur archivage sont gérés par Stripe.
- **Cohérence garantie.** Le portail applique la même proration et les mêmes règles que ton API : pas de divergence entre « ce que fait le client » et « ce que ferait ton back-office ».

Le prix à payer : une UI que tu ne contrôles pas finement (seulement le branding et les features activées). Pour un MVP comme TribuZen, c'est un échange très favorable.

---

## 3. Worked examples

### Exemple 1 — Endpoint NestJS qui ouvre le portail

```ts
// src/billing/billing.controller.ts
import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../users/user.entity';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // Route protégée : seul un utilisateur CONNECTÉ ouvre SON portail.
  // (Contraste avec le webhook du module 03 qui, lui, n'a pas de JWT.)
  @Post('portal')
  @UseGuards(JwtAuthGuard)
  async openPortal(@CurrentUser() user: User): Promise<{ url: string }> {
    const url = await this.billing.createPortalSession(user);
    return { url }; // le front redirige window.location.href = url
  }
}
```

```ts
// src/billing/billing.service.ts
import {
  Injectable, Inject, BadRequestException, Logger,
} from '@nestjs/common';
import Stripe from 'stripe';
import type { User } from '../users/user.entity';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(@Inject('STRIPE_CLIENT') private readonly stripe: Stripe) {}

  async createPortalSession(user: User): Promise<string> {
    // 1. Garde-fou : sans Customer Stripe, aucun portail possible.
    //    stripeCustomerId a été rattaché au module 03 (checkout.session.completed).
    if (!user.stripeCustomerId) {
      throw new BadRequestException(
        "Aucun abonnement Stripe rattaché à ce compte",
      );
    }

    // 2. Création de la session de portail — customer + return_url.
    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId, // 'cus_...'
      return_url: `${process.env.APP_URL}/parametres/abonnement`,
    });

    this.logger.log(`Portail ouvert pour user ${user.id}`);

    // 3. On renvoie l'URL hébergée Stripe. À usage unique : jamais stockée.
    return session.url;
  }
}
```

Points clés :
- La route est **protégée par JWT** : on ouvre le portail *du client connecté*, avec *son* `cus_...` — jamais un id passé par le client.
- **Garde-fou `stripeCustomerId`** : un utilisateur Free (jamais passé au Checkout) n'a pas de Customer → 400 explicite plutôt qu'une erreur Stripe opaque.
- On ne stocke pas `session.url` : elle expire, on la recrée à chaque clic.

### Exemple 2 — Déclenchement côté front

```ts
// Front — bouton "Gérer mon abonnement"
async function openBillingPortal() {
  const res = await fetch('/api/billing/portal', {
    method: 'POST',
    credentials: 'include', // envoie le cookie/JWT
  });
  const { url } = await res.json();
  window.location.href = url; // redirection vers la page hébergée Stripe
}
```

Le client part sur Stripe, gère son abonnement, puis Stripe le renvoie sur le `return_url` (`/parametres/abonnement`). Les changements qu'il a faits (plan, annulation) arrivent **en parallèle** via webhooks — c'est eux, et non le retour navigateur, qui mettent à jour son `tier` (règle du module 03).

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Recoder les écrans de gestion soi-même

```txt
❌ Écran "changer de carte" maison → tu touches des données de carte → périmètre PCI
✅ Customer Portal → le formulaire carte est chez Stripe, hors de ton serveur
```

Tout écran qui manipule un moyen de paiement te fait entrer dans le périmètre PCI et t'oblige à maintenir une UI sensible. Le portail existe précisément pour t'éviter ça.

### PIÈGE #2 — Utiliser le `return_url` comme source de vérité

```ts
// ❌ Le client revient sur /parametres/abonnement → on croit qu'il a annulé
//    Faux : il a pu fermer sans rien faire, ou l'annulation est "en fin de période"
if (searchParams.get('returned')) user.tier = 'free';
```

Le `return_url` est **purement UX** — il ramène le client dans l'app, rien de plus. L'état réel (plan changé, annulation) arrive par **webhook** `customer.subscription.*`. Même piège de fond qu'au module 03 : le navigateur ne décide jamais du `tier`.

### PIÈGE #3 — Ouvrir le portail sans Customer Stripe

```ts
// ❌ user.stripeCustomerId est undefined (utilisateur Free jamais passé au Checkout)
//    → Stripe renvoie une erreur "No such customer" peu claire
await stripe.billingPortal.sessions.create({ customer: undefined });

// ✅ Garde-fou explicite avant l'appel
if (!user.stripeCustomerId) throw new BadRequestException('Pas d\'abonnement');
```

Un Free n'a pas de `cus_...`. Vérifie-le avant l'appel et renvoie une erreur métier claire (ou masque simplement le bouton côté front).

### PIÈGE #4 — Oublier de configurer/activer le portail

Avant toute session, le portail doit être **activé et configuré** (Dashboard ou API). Sinon `billingPortal.sessions.create` échoue avec une erreur de configuration. C'est une étape à part entière, pas un défaut prêt à l'emploi.

### PIÈGE #5 — Annulation immédiate par défaut

```txt
❌ subscription_cancel en mode "immediately" → l'accès est coupé sur-le-champ,
   alors que le client a déjà payé jusqu'à la fin du mois → perçu comme un vol
✅ mode "at_period_end" → Premium jusqu'au terme payé, retour Free ensuite
```

Aligne le mode d'annulation du portail sur `cancel_at_period_end` (module 04) : le client garde ce qu'il a payé, et tu récupères un `customer.subscription.deleted` en fin de période.

### PIÈGE #6 — Croire que le portail court-circuite tes webhooks

Le portail **déclenche les mêmes events** que ton API (`customer.subscription.updated/deleted`). Ce n'est pas un canal séparé : si ton handler webhook du module 03 est correct, les actions faites dans le portail sont déjà gérées. Rien de spécial à câbler côté réception.

---

## 5. Ancrage TribuZen

Dans TribuZen, le Customer Portal est **l'unique écran de gestion d'abonnement** côté famille. La page `Paramètres → Abonnement` ne contient qu'un état de synthèse (plan courant, prochaine échéance) et **un seul bouton** « Gérer mon abonnement » qui ouvre le portail.

Flux réel :

1. Un parent ouvre `Paramètres → Abonnement`, clique « Gérer mon abonnement ».
2. Le front `POST /api/billing/portal` → l'endpoint NestJS (Exemple 1) crée la session avec le `stripeCustomerId` de la famille et redirige vers Stripe.
3. Dans le portail, la famille passe du mensuel à l'annuel, ou met sa carte à jour, ou télécharge ses factures, ou annule — **sans jamais écrire au support**.
4. Stripe renvoie la famille sur `/parametres/abonnement` (`return_url`).
5. En parallèle, `customer.subscription.updated` (ou `.deleted`) arrive sur le webhook (module 03) → TribuZen met à jour le `tier` et la période. **C'est le webhook, pas le retour navigateur, qui fait foi.**

Fichiers cibles dans `smaurier/tribuzen` :

```txt
tribuzen-api/
  src/
    billing/
      billing.controller.ts   ← Exemple 1 (POST /billing/portal, JWT)
      billing.service.ts       ← createPortalSession (billingPortal.sessions.create)
tribuzen-web/
  src/
    pages/parametres/abonnement  ← bouton "Gérer mon abonnement" (Exemple 2)
```

> Configuration du portail (features activées, annulation `at_period_end`, return_url par défaut) : faite **une fois** dans le Dashboard Stripe en mode test, avant le premier lab. Le calcul fin du `tier` selon le statut reste géré par les webhooks du module 03 et la logique du module 04.

---

## 6. Points clés

1. Le **Customer Portal** est une page hébergée par Stripe pour l'après-vente : le client gère son abonnement seul, tu ne construis aucune UI de gestion.
2. On ouvre une session avec `stripe.billingPortal.sessions.create({ customer, return_url })` et on redirige vers `session.url` (à usage unique, jamais stockée).
3. `customer` (`cus_...`) est **requis** — c'est le `stripeCustomerId` rattaché à l'utilisateur au module 03.
4. Le client peut changer de plan, mettre à jour son moyen de paiement, annuler, télécharger ses factures — selon les **features** activées (`subscription_update`, `payment_method_update`, `subscription_cancel`, `invoice_history`).
5. Le portail se **configure** dans le Dashboard (`Settings → Billing → Customer portal`) ou par API ; l'annulation doit être en **fin de période** (`at_period_end`), cohérente avec le module 04.
6. Le `return_url` est **UX seulement** ; l'état réel arrive par les **webhooks** `customer.subscription.*` (module 03) — le navigateur ne décide jamais du `tier`.
7. Le portail **réduit le support** et **délègue la conformité PCI/RGPD** à Stripe : aucun numéro de carte ne transite par ton serveur.
8. La route `/billing/portal` est protégée par **JWT** (on ouvre le portail du client connecté, avec son propre `cus_...`).

---

## 7. Seeds Anki

```
Comment ouvre-t-on une session de Customer Portal Stripe ?|stripe.billingPortal.sessions.create({ customer, return_url }) — customer (cus_...) est requis, return_url ramène le client dans l'app. On redirige vers session.url (à usage unique, jamais stockée).
Quel paramètre est REQUIS pour créer une session de portail ?|customer : l'identifiant cus_... du client (le stripeCustomerId rattaché à l'utilisateur au module 03 via checkout.session.completed). Sans lui, pas de session.
À quoi sert le return_url d'une session de portail ?|Uniquement à ramener le client dans ton app quand il ferme le portail (UX). L'état réel (plan changé, annulation) arrive par webhook customer.subscription.* — le return_url ne fait jamais foi.
Que peut faire le client seul dans le Customer Portal ?|Changer de plan (subscription_update), mettre à jour son moyen de paiement (payment_method_update), annuler (subscription_cancel), télécharger ses factures (invoice_history) — selon les features activées.
Où configure-t-on le Customer Portal, et quel mode d'annulation choisir ?|Dashboard (Settings → Billing → Customer portal) ou par API (billingPortal.configurations). Annulation en fin de période (at_period_end), cohérente avec cancel_at_period_end du module 04.
Pourquoi le Customer Portal réduit-il le support et sécurise la conformité ?|Le client se sert seul 24/7 (moins de tickets), aucun numéro de carte ne transite par ton serveur (hors périmètre PCI lourd), et Stripe gère les factures/RGPD. Tu ne maintiens aucun écran de paiement.
Faut-il un garde-fou avant d'ouvrir le portail ?|Oui : vérifier user.stripeCustomerId. Un utilisateur Free jamais passé au Checkout n'a pas de cus_... → renvoyer une erreur métier claire (400) plutôt qu'une erreur Stripe "No such customer".
Le portail court-circuite-t-il tes webhooks ?|Non. Les actions du portail déclenchent les MÊMES events (customer.subscription.updated/deleted) que ton API. Si le handler du module 03 est correct, elles sont déjà gérées — rien de spécial à câbler.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-05-customer-portal-et-self-service/README.md`. Construire l'endpoint NestJS `POST /billing/portal` qui ouvre le Customer Portal pour une famille TribuZen (vrai SDK Stripe en mode test, portail configuré dans le Dashboard, testé de bout en bout) — zéro harnais simulé, corrigé complet commenté.
