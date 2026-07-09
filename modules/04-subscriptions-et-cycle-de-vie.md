---
titre: Subscriptions et cycle de vie
cours: 22-stripe-billing
notions: ["statuts d'abonnement", "current_period_start/end", "trial_period_days", "trial_will_end", "proration", "proration_behavior", "upgrade/downgrade via subscriptions.update", "cancel_at_period_end", "annulation immédiate", "reprise"]
outcomes:
  - sait lire le statut d'un abonnement Stripe et savoir quel accès accorder
  - sait ajouter un essai gratuit avec trial_period_days et réagir à trial_will_end
  - sait changer de plan (upgrade/downgrade) via subscriptions.update en pilotant la proration
  - sait annuler en fin de période vs immédiatement, et reprendre un abonnement programmé pour annulation
prerequis: ["00-introduction-au-billing-saas", "01-stripe-products-et-prices", "02-stripe-checkout-et-payment-links", "03-webhooks-et-idempotence"]
next: 05-customer-portal-et-self-service
libs: [{ name: stripe, version: "^17" }]
tribuzen: billing TribuZen Premium — cycle de vie de l'abonnement famille (essai, passage mensuel→annuel, annulation, reprise) piloté par les webhooks
last-reviewed: 2026-07
---

# Subscriptions et cycle de vie

> **Outcomes — tu sauras FAIRE :** lire un statut d'abonnement et accorder l'accès en conséquence, ajouter un essai gratuit, changer de plan avec proration, annuler en fin de période vs immédiatement et reprendre un abonnement.
> **Difficulté :** :star::star::star:
>
> **Sécurité clés :** aucune vraie clé dans ce module. Les clés Stripe vivent dans `.env` (jamais commité). Le code n'affiche que des placeholders cassés type `sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>`.

## 1. Cas concret d'abord

La famille Martin est sur **TribuZen Premium**. Voici trois demandes qui arrivent le même jour au support :

1. « On a commencé un essai gratuit il y a 5 jours, il nous reste combien de temps ? »
2. « On paie au mois, on veut passer à l'**annuel** (moins cher). Est-ce qu'on paie deux fois ce mois-ci ? »
3. « Finalement on part. On veut **annuler**, mais garder l'accès jusqu'à la fin de ce qu'on a payé. »

Ces trois questions touchent le même objet Stripe : la **Subscription**. Elle a un **statut** (`trialing`, `active`, `past_due`, `canceled`…), une **période courante** (`current_period_start` / `current_period_end`), et se pilote par `stripe.subscriptions.update(...)`.

Le piège de débutant : croire qu'un abonnement est un booléen « payé / pas payé ». En réalité c'est une **machine à états**. Répondre correctement aux trois demandes, c'est savoir lire le statut, déclencher un changement de prix avec la bonne **proration**, et distinguer annulation immédiate d'annulation en fin de période. Ce module couvre exactement ça.

> Rappel du module 03 : **c'est le webhook qui fait foi**, pas le retour d'un appel SDK côté serveur ni un `success_url`. On modifie l'abonnement via le SDK, puis on met à jour notre base à la réception de `customer.subscription.updated` / `.deleted`.

---

## 2. Théorie complète, concise

### 2.1 La Subscription est une machine à états

Une Subscription Stripe porte un champ `status`. C'est lui, et lui seul, qui décide de l'accès produit. Les valeurs (vérifiées sur docs.stripe.com) :

| Statut | Sens | Accès Premium ? |
|--------|------|-----------------|
| `trialing` | En période d'essai. Passe à `active` au premier paiement réussi. | Oui |
| `active` | À jour. | Oui |
| `incomplete` | Abonnement créé mais 1er paiement pas encore confirmé (client a ~23 h, ou authentification 3DS requise). | Non (pas encore) |
| `incomplete_expired` | 1er paiement jamais confirmé dans les 23 h → abonnement mort. | Non |
| `past_due` | Un paiement de renouvellement a échoué. Stripe retente (dunning — module 07). | À décider (souvent oui pendant les retries) |
| `unpaid` | Après échec des retries : facture non réglée, mais l'abonnement existe encore. | Non (révoquer l'accès) |
| `canceled` | Annulé (état final). Non modifiable sauf `metadata`. | Non |
| `paused` | Essai terminé sans moyen de paiement, avec `end_behavior = pause`. Aucune facture émise. | Non |

**Règle d'or :** ne jamais coder « si `status !== 'canceled'` alors Premium ». Mapper explicitement chaque statut vers un droit d'accès. Pour TribuZen : `trialing` et `active` → Premium ; tout le reste → dégradé/free.

### 2.2 Périodes de facturation

Deux timestamps Unix (secondes) décrivent le cycle courant :

- `current_period_start` — début de la période payée en cours.
- `current_period_end` — fin de la période payée en cours. C'est **la date jusqu'à laquelle l'accès est garanti**, et la date à laquelle Stripe tentera le prochain renouvellement.

> ⚠️ **Depuis la version d'API Basil (2025-03-31, incluse dans `2026-06-24.dahlia`)**, `current_period_start/end` **ne sont plus des champs top-level de la Subscription** : ils vivent sur l'**item d'abonnement**. On les lit via `subscription.items.data[0].current_period_end` (un abonnement peut avoir plusieurs items, chacun avec sa période). Le code de ce module utilise donc cette forme.

En JavaScript, on convertit en millisecondes (`× 1000`) :

```ts
const periodEnd = new Date(subscription.items.data[0].current_period_end * 1000)
```

C'est cette date qu'on affiche « Renouvellement le 14 août 2026 » et qu'on stocke pour savoir jusqu'à quand honorer l'accès après une annulation en fin de période.

### 2.3 Essais gratuits — `trial_period_days`

On offre un essai en passant `trial_period_days` à la création (via `subscriptions.create` ou via une Checkout Session en `mode: 'subscription'` avec `subscription_data.trial_period_days`).

```ts
// À la création de l'abonnement
const subscription = await stripe.subscriptions.create({
  customer: customerId,
  items: [{ price: priceMonthlyId }],
  trial_period_days: 14,
})
// subscription.status === 'trialing'
// subscription.trial_end === timestamp de fin d'essai
```

Cycle d'un essai :

1. Statut initial `trialing`. `trial_end` = timestamp de fin.
2. **3 jours avant** `trial_end`, Stripe émet `customer.subscription.trial_will_end` (si l'essai dure moins de 3 jours, l'event part immédiatement). Usage TribuZen : email « votre essai se termine bientôt ».
3. À la fin de l'essai : si un moyen de paiement est présent, Stripe facture → statut `active`. Sinon, le comportement dépend de `trial_settings.end_behavior.missing_payment_method` :
   - `cancel` → passe `canceled` (event `customer.subscription.deleted`).
   - `pause` → passe `paused` (event `customer.subscription.paused`), aucune facture, accès à révoquer jusqu'à ajout d'un moyen de paiement.

> Note doc : Stripe pousse aussi une nouvelle API « Trial Offers » (essais remisés). Pour un essai gratuit classique, `trial_period_days` reste le paramètre standard et suffisant. Ne pas mélanger `trial_period_days` et l'API Trial Offers sur le même abonnement.

### 2.4 Changer de plan — `subscriptions.update`

Pour un upgrade/downgrade (mensuel → annuel, ou premium → family), on **remplace le prix de l'item d'abonnement existant**. Le point crucial : il faut passer l'**`id` de l'item d'abonnement** (`si_...`), pas seulement le nouveau `price`. Sans `id`, Stripe **ajoute** un second item au lieu de remplacer.

```ts
// Récupérer l'id de l'item courant
const subscription = await stripe.subscriptions.retrieve(subscriptionId)
const itemId = subscription.items.data[0].id // "si_..."

// Remplacer le prix
await stripe.subscriptions.update(subscriptionId, {
  items: [{ id: itemId, price: priceYearlyId }],
  proration_behavior: 'create_prorations',
})
```

### 2.5 Proration — `proration_behavior`

Changer de prix en milieu de période crée un déséquilibre : le client a payé pour un plan, il en prend un autre. La **proration** calcule le crédit/débit au prorata des jours restants. Trois comportements (vérifiés sur docs.stripe.com) :

| `proration_behavior` | Effet |
|----------------------|-------|
| `create_prorations` (défaut) | Crée des lignes de proration (crédit sur l'ancien, débit sur le nouveau) appliquées à la **prochaine** facture. |
| `always_invoice` | Idem, mais **facture immédiatement** l'ajustement (le client paie tout de suite le différentiel). |
| `none` | Aucune proration. Le changement s'applique sans ajustement financier. |

**Upgrade** (vers plus cher) : `always_invoice` est courant pour encaisser tout de suite. **Downgrade** (vers moins cher) : souvent `none` ou `create_prorations` pour appliquer au prochain cycle sans rembourser au prorata.

### 2.6 Annulation — fin de période vs immédiate

Deux sémantiques opposées :

```ts
// (A) Annulation EN FIN DE PÉRIODE — recommandé pour TribuZen
// L'accès continue jusqu'à current_period_end, puis l'abonnement s'éteint.
await stripe.subscriptions.update(subscriptionId, {
  cancel_at_period_end: true,
})
// status reste 'active' — event customer.subscription.updated
// (cancel_at_period_end passe à true). Le .deleted arrivera à la fin de période.

// (B) Annulation IMMÉDIATE — coupe tout de suite
await stripe.subscriptions.cancel(subscriptionId)
// status passe 'canceled' — event customer.subscription.deleted immédiat.
```

- `cancel_at_period_end: true` : l'abonnement reste `active` (ou `trialing`), l'accès est honoré jusqu'à `current_period_end`. À la fin, Stripe émet `customer.subscription.deleted`. C'est le choix par défaut d'un SaaS respectueux : le client a payé jusque-là.
- `stripe.subscriptions.cancel(id)` : coupe immédiatement, statut `canceled`, event `.deleted` tout de suite. Pas de remboursement automatique de la période restante (sauf proration explicite).

### 2.7 Reprise — annuler l'annulation

Tant que la période n'est **pas terminée**, un abonnement programmé pour annulation (`cancel_at_period_end: true`) peut être **repris** :

```ts
await stripe.subscriptions.update(subscriptionId, {
  cancel_at_period_end: false,
})
// L'abonnement continuera normalement au prochain renouvellement.
```

**Limite dure :** on ne peut PAS reprendre un abonnement déjà `canceled` (annulation immédiate ou fin de période atteinte). Il faut en **créer un nouveau**. D'où l'intérêt de préférer `cancel_at_period_end` : ça laisse une fenêtre de rétractation.

---

## 3. Worked examples

### Exemple 1 — Upgrade mensuel → annuel avec facturation immédiate (TribuZen)

Demande 2 du cas concret : la famille Martin passe du mensuel à l'annuel et veut payer le différentiel maintenant.

```ts
// src/billing/subscription.service.ts (NestJS)
import { Injectable, Inject } from '@nestjs/common'
import Stripe from 'stripe'

@Injectable()
export class SubscriptionService {
  constructor(@Inject('STRIPE_CLIENT') private readonly stripe: Stripe) {}

  /**
   * Passe un abonnement TribuZen Premium du prix mensuel au prix annuel.
   * proration_behavior 'always_invoice' : le client paie tout de suite
   * le différentiel au prorata des jours restants.
   */
  async switchToYearly(subscriptionId: string): Promise<Stripe.Subscription> {
    // 1. Retrouver l'item d'abonnement existant (il faut son id "si_...")
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId)
    const currentItemId = sub.items.data[0].id

    // 2. Remplacer le prix mensuel par le prix annuel
    //    process.env.STRIPE_PRICE_PREMIUM_YEARLY = "price_..." (dans .env, jamais commité)
    const updated = await this.stripe.subscriptions.update(subscriptionId, {
      items: [
        {
          id: currentItemId, // ← CRUCIAL : remplace au lieu d'ajouter
          price: process.env.STRIPE_PRICE_PREMIUM_YEARLY,
        },
      ],
      proration_behavior: 'always_invoice', // facture le différentiel immédiatement
    })

    // 3. NE PAS mettre à jour la base ici à partir de `updated`.
    //    On attend le webhook customer.subscription.updated (source de vérité, module 03).
    return updated
  }
}
```

À la réception du webhook `customer.subscription.updated`, le handler (module 03) lit `subscription.items.data[0].price.id` pour recalculer le tier et `current_period_end` pour la nouvelle date de renouvellement (qui repart pour un an).

### Exemple 2 — Annulation en fin de période puis reprise

Demande 3 : annuler mais garder l'accès jusqu'à la fin. Puis la famille change d'avis et reprend.

```ts
/**
 * Programme l'annulation à la fin de la période payée.
 * L'accès Premium reste actif jusqu'à current_period_end.
 */
async cancelAtPeriodEnd(subscriptionId: string): Promise<Stripe.Subscription> {
  return this.stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  })
  // status reste 'active' ; webhook customer.subscription.updated
  // avec cancel_at_period_end = true. Le .deleted viendra en fin de période.
}

/**
 * Annule l'annulation programmée (tant que la période n'est pas finie).
 * Impossible si l'abonnement est déjà 'canceled' — il faudrait en recréer un.
 */
async resume(subscriptionId: string): Promise<Stripe.Subscription> {
  return this.stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  })
}
```

Côté UI, on affiche l'état d'annulation programmée en lisant `subscription.cancel_at_period_end` : s'il est `true`, montrer « Votre abonnement se terminera le {{ dateFin }} » et un bouton « Reprendre mon abonnement ».

> Inline VitePress : le placeholder <code v-pre>{{ dateFin }}</code> est du texte d'interface, pas une interpolation Vue à exécuter.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — `subscriptions.update` sans l'`id` de l'item → prix ajouté au lieu de remplacé

```ts
// ❌ Oublie l'id → Stripe AJOUTE un second item : le client paie les DEUX prix
await stripe.subscriptions.update(subId, {
  items: [{ price: newPriceId }],
})

// ✅ Passer l'id de l'item existant → remplacement
await stripe.subscriptions.update(subId, {
  items: [{ id: currentItemId, price: newPriceId }],
})
```

C'est l'erreur n°1 sur les changements de plan. Toujours `retrieve` puis lire `items.data[0].id`.

### PIÈGE #2 — Traiter le statut comme un booléen

```ts
// ❌ "pas canceled donc Premium" — faux pour incomplete, unpaid, paused…
if (sub.status !== 'canceled') grantPremium()

// ✅ mapping explicite
const PREMIUM_STATUSES = ['trialing', 'active']
if (PREMIUM_STATUSES.includes(sub.status)) grantPremium()
else revokePremium()
```

`incomplete`, `unpaid`, `paused` ne sont PAS `canceled` mais ne donnent pas droit à l'accès.

### PIÈGE #3 — Confondre `cancel_at_period_end: true` et annulation immédiate

`cancel_at_period_end: true` **ne change pas le statut** : il reste `active`. L'event est `customer.subscription.updated`, pas `.deleted`. Le `.deleted` n'arrive qu'à la fin de la période. Si on attend `.deleted` pour afficher « annulation programmée », on n'affichera jamais rien. Écouter `updated` et lire `cancel_at_period_end`.

### PIÈGE #4 — Croire qu'on peut reprendre n'importe quel abonnement annulé

On ne reprend (`cancel_at_period_end: false`) qu'un abonnement **encore actif** programmé pour annulation. Un abonnement déjà `canceled` (immédiat, ou fin de période atteinte) est un état **final** : il faut en créer un nouveau. Ne pas promettre un bouton « Reprendre » sur un abonnement `canceled`.

### PIÈGE #5 — Oublier la proration ou choisir le mauvais comportement

Sur un **upgrade**, `proration_behavior: 'none'` fait cadeau du différentiel au client (il profite du plan supérieur sans payer l'écart avant le prochain cycle). Sur un **downgrade**, `always_invoice` peut générer une facture négative/un crédit surprenant. Choisir consciemment : upgrade immédiat → `always_invoice` ; downgrade au prochain cycle → `none` ou `create_prorations`.

### PIÈGE #6 — Timestamps Stripe en secondes, pas en millisecondes

`current_period_end`, `trial_end` sont des timestamps Unix **en secondes**. `new Date(sub.items.data[0].current_period_end)` sans `× 1000` donne une date en 1970. Toujours `new Date(ts * 1000)`.

---

## 5. Ancrage TribuZen

Dans TribuZen, le cycle de vie de l'abonnement famille est piloté côté back-office NestJS, mais **toute mise à jour de notre base passe par les webhooks** (module 03), jamais par le retour direct des appels SDK.

Mapping statut → accès dans `smaurier/tribuzen` :

```ts
// src/billing/subscription-tier.ts
export function tierFromStatus(status: Stripe.Subscription.Status): 'premium' | 'free' {
  // trialing + active = accès Premium ; tout le reste = dégradé
  return status === 'trialing' || status === 'active' ? 'premium' : 'free'
}
```

Parcours réel d'une famille TribuZen :

1. **Essai** : Checkout en `mode: 'subscription'` avec `trial_period_days: 14` → statut `trialing`, accès Premium immédiat.
2. **J-3 avant fin d'essai** : webhook `trial_will_end` → email de rappel.
3. **Fin d'essai** : paiement OK → `active`. Pas de moyen de paiement → `paused` (accès coupé).
4. **Upgrade mensuel → annuel** : `switchToYearly()` (Exemple 1), `proration_behavior: 'always_invoice'`.
5. **Annulation** : bouton « Résilier » → `cancel_at_period_end: true`. Accès maintenu jusqu'à `current_period_end`.
6. **Rétractation** : bouton « Reprendre » → `cancel_at_period_end: false`.

Fichiers cibles :

```
tribuzen/
  src/
    billing/
      subscription.service.ts    ← switchToYearly, cancelAtPeriodEnd, resume
      subscription-tier.ts       ← mapping statut → droit d'accès
      stripe-webhook.service.ts  ← applique les changements à la base (module 03)
```

> En pratique, on déléguera une partie de ces actions (changer de plan, annuler) au **Customer Portal** hébergé par Stripe — c'est le module 05. Ce module 04 est le socle SDK qui explique ce que le portail fait sous le capot.

---

## 6. Points clés

1. La Subscription est une **machine à états** : `status` (`trialing`/`active`/`past_due`/`canceled`/`incomplete`/`unpaid`/`paused`) décide de l'accès — jamais un booléen.
2. `current_period_end` (timestamp Unix **en secondes**, `× 1000` en JS) = date jusqu'à laquelle l'accès est garanti et date du prochain renouvellement.
3. Essai : `trial_period_days` → statut `trialing` ; `customer.subscription.trial_will_end` part **3 jours avant** la fin.
4. Changer de plan : `subscriptions.update` avec l'**`id` de l'item** (`si_...`) sinon le prix est ajouté, pas remplacé.
5. `proration_behavior` : `create_prorations` (défaut, prochaine facture), `always_invoice` (facture tout de suite), `none` (aucun ajustement).
6. `cancel_at_period_end: true` = annulation en fin de période (statut reste `active`, event `updated`) ; `subscriptions.cancel(id)` = immédiate (statut `canceled`, event `deleted`).
7. Reprise = `cancel_at_period_end: false`, uniquement tant que l'abonnement n'est pas `canceled` ; sinon recréer.
8. La source de vérité reste le **webhook** (module 03) : on modifie via le SDK, on persiste à la réception de `customer.subscription.updated` / `.deleted`.

---

## 7. Seeds Anki

```
Qu'est-ce qui décide de l'accès Premium : le statut d'abonnement ou "pas canceled" ?|Le statut, via un mapping explicite. Seuls trialing et active donnent l'accès. incomplete, unpaid, paused ne sont pas canceled mais ne donnent PAS l'accès.
Pourquoi faut-il passer l'id de l'item dans subscriptions.update pour changer de prix ?|Sans l'id de l'item (si_...), Stripe AJOUTE un second item au lieu de remplacer le prix — le client paierait les deux. On retrieve puis on lit items.data[0].id.
Quels sont les trois proration_behavior et leur effet ?|create_prorations (défaut : lignes de proration sur la prochaine facture), always_invoice (facture le différentiel immédiatement), none (aucun ajustement financier).
Différence entre cancel_at_period_end:true et subscriptions.cancel(id) ?|cancel_at_period_end:true = annulation en fin de période, statut reste active, event customer.subscription.updated, .deleted à la fin. cancel(id) = immédiat, statut canceled, event .deleted tout de suite.
Peut-on reprendre n'importe quel abonnement annulé ?|Non. On ne reprend (cancel_at_period_end:false) qu'un abonnement encore actif programmé pour annulation. Un abonnement déjà canceled est final : il faut en créer un nouveau.
Quand part l'event customer.subscription.trial_will_end ?|3 jours avant la fin de l'essai (immédiatement si l'essai dure moins de 3 jours). Usage : email de rappel de fin d'essai.
Pourquoi new Date(sub.items.data[0].current_period_end) donne-t-il une date en 1970 ?|Les timestamps Stripe sont en secondes Unix, pas en millisecondes. Il faut new Date(sub.items.data[0].current_period_end * 1000).
Que se passe-t-il à la fin d'un essai sans moyen de paiement selon trial_settings.end_behavior.missing_payment_method ?|cancel → statut canceled (event .deleted) ; pause → statut paused (event .paused), aucune facture, accès à révoquer jusqu'à ajout d'un moyen de paiement.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-04-subscriptions-et-cycle-de-vie/README.md`. Gérer un upgrade mensuel→annuel et une annulation de TribuZen Premium via le vrai SDK Stripe en mode test, et observer les changements de statut via `stripe listen`. Corrigé complet commenté, zéro harnais simulé.
