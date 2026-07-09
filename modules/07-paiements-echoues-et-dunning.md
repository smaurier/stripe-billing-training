---
titre: Paiements échoués et dunning (relance, SCA/3DS, révocation)
cours: 22-stripe-billing
notions: ["invoice.payment_failed", "statut past_due", "statut unpaid", "smart retries", "dunning / relances automatiques", "attempt_count", "next_payment_attempt", "codes de decline non-retryable", "emails de relance Stripe", "révocation d'accès à l'échéance", "end_behavior après épuisement des retries", "SCA / 3D Secure", "requires_action", "requires_payment_method", "invoice.payment_action_required", "hosted invoice page", "cartes de test d'échec et 3DS"]
outcomes:
  - sait router invoice.payment_failed et faire passer l'abonnement en past_due sans couper Premium tout de suite
  - sait expliquer le dunning (smart retries) et lire attempt_count / next_payment_attempt
  - sait choisir le comportement de fin de dunning (canceled / unpaid / past_due) et révoquer l'accès au bon moment
  - sait gérer une authentification forte SCA/3DS sur renouvellement via invoice.payment_action_required et la hosted invoice page
  - sait reproduire un échec et un challenge 3DS avec les cartes de test Stripe
prerequis: ["00-introduction-au-billing-saas", "01-stripe-products-et-prices", "02-stripe-checkout-et-payment-links", "03-webhooks-et-idempotence", "04-subscriptions-et-cycle-de-vie", "05-customer-portal-et-self-service", "06-freemium-et-feature-gating"]
next: 08-facturation-taxes-et-legalite
libs: [{ name: stripe, version: "^17" }]
tribuzen: billing TribuZen Premium — la carte de la famille expire, Stripe relance (dunning), on maintient l'accès pendant les retries puis on révoque Premium si la facture reste impayée
last-reviewed: 2026-07
---

# Paiements échoués et dunning (relance, SCA/3DS, révocation)

> **Outcomes — tu sauras FAIRE :** router `invoice.payment_failed` et gérer le statut `past_due`, expliquer le dunning (smart retries), choisir quand révoquer l'accès, et traiter une authentification forte SCA/3DS sur un renouvellement via `invoice.payment_action_required`.
> **Difficulté :** :star::star::star::star:
>
> **Sécurité clés :** aucune vraie clé dans ce module. Les clés Stripe vivent dans `.env` (jamais commité) ; le code n'affiche que des placeholders cassés type `sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>`. Les **cartes de test** (`4242 4242 4242 4242`, `4000 0000 0000 0341`, `4000 0025 0000 3155`) sont des valeurs **publiques** de la doc Stripe — ce ne sont pas des secrets.

## 1. Cas concret d'abord

La famille Martin est sur **TribuZen Premium** depuis un an, en abonnement annuel. Le jour du renouvellement, leur carte bancaire a **expiré** — ils ont reçu la nouvelle mais n'ont pas mis à jour leur moyen de paiement. Le prélèvement échoue.

Trois mauvaises réactions, toutes tentantes :

1. **Couper Premium immédiatement.** Une famille fidèle depuis un an perd l'accès à ses routines et son journal pour une carte expirée. Elle part, furieuse, alors qu'elle aurait payé si on l'avait juste relancée.
2. **Ne rien faire et laisser l'accès ouvert « pour ne pas fâcher ».** Tu offres Premium gratuitement à quelqu'un qui ne paie plus. Multiplié par N clients, c'est du revenu perdu.
3. **Écrire son propre système de relance** (cron qui retente le paiement tous les 3 jours, envoie des emails…). Des semaines de code fragile pour réinventer ce que Stripe fait déjà mieux.

La bonne réponse : Stripe gère la **relance automatique** (le *dunning*, ou *smart retries*). Quand un renouvellement échoue, Stripe passe l'abonnement en **`past_due`**, **retente** le paiement selon un calendrier optimisé, **envoie des emails de relance** au client, et t'informe à chaque étape via le webhook **`invoice.payment_failed`**. Toi, tu décides d'une seule chose : **jusqu'à quand honorer l'accès**, et **quand le révoquer** si la facture reste impayée.

Ce module câble ce cycle : recevoir l'échec, maintenir Premium pendant les retries, gérer le cas particulier de l'**authentification forte (SCA/3DS)** sur renouvellement, et révoquer proprement à l'échéance.

---

## 2. Théorie complète, concise

### 2.1 Un renouvellement qui échoue → `invoice.payment_failed`

Au renouvellement, Stripe génère une facture (`invoice`) et tente de la prélever **off-session** (le client n'est pas là, on utilise sa carte enregistrée). Si le prélèvement échoue (carte expirée, fonds insuffisants, refus banque…), Stripe :

- passe la facture en échec et émet le webhook **`invoice.payment_failed`** ;
- passe l'abonnement en statut **`past_due`** (voir 2.3) ;
- **planifie une nouvelle tentative** (le dunning, 2.2).

L'objet `Invoice` de l'event porte les infos clés du dunning :

| Champ | Sens |
|-------|------|
| `attempt_count` | Nombre de tentatives de paiement déjà faites pour cette facture. |
| `next_payment_attempt` | Timestamp Unix de la **prochaine** relance automatique (`null` si Stripe ne retentera plus). |
| `customer` | Le customer (`cus_...`) concerné — sert à retrouver l'utilisateur TribuZen. |
| `parent.subscription_details.subscription` | L'abonnement lié. **Depuis l'API Basil**, il n'est plus top-level (`invoice.subscription` retiré) : on le lit via `invoice.parent.subscription_details.subscription`. |

> **Règle TribuZen :** à la réception de `invoice.payment_failed`, on **ne coupe PAS Premium**. On marque la famille `past_due` et on la prévient. La coupure éventuelle vient plus tard, à la fin du dunning (2.4).

### 2.2 Le dunning : smart retries (relances intelligentes)

Le *dunning* est le processus de **relance d'un paiement échoué**. Stripe propose deux modes (configurés dans le Dashboard, pas dans le code) :

- **Smart Retries (recommandé, par défaut).** Stripe choisit le **meilleur moment** pour retenter, avec un modèle qui apprend des signaux (heure locale optimale, présence de la carte sur un appareil récemment…). Tu configures juste un **nombre de tentatives sur une durée** — par défaut **8 tentatives sur 2 semaines** (options : 1 semaine, 2 semaines, 3 semaines, 1 mois, 2 mois).
- **Custom retry rules.** Jusqu'à **3 relances** à des délais fixes que tu définis toi-même.

À chaque tentative qui échoue, Stripe **réémet `invoice.payment_failed`** avec `attempt_count` incrémenté et un nouveau `next_payment_attempt`. Le champ `next_payment_attempt` te dit quand aura lieu la prochaine relance ; s'il est `null`, c'est que Stripe **n'en fera plus** — le dunning est terminé.

> Certains **codes de decline sont non-retryable** : `lost_card`, `stolen_card`, `incorrect_number`, `authentication_required`, etc. Pour ceux-là, une relance à l'identique est inutile — il faut un **nouveau moyen de paiement**. Stripe continue son calendrier mais le paiement ne passera qu'après mise à jour de la carte.

### 2.3 Statuts d'échec : `past_due`, `unpaid`, `canceled`

Trois statuts d'abonnement gravitent autour de l'échec de paiement (rappel du module 04, précisé ici) :

| Statut | Sens | Stripe retente encore ? | Accès TribuZen |
|--------|------|-------------------------|----------------|
| `past_due` | Le dernier paiement a échoué, **le dunning est en cours**. | Oui | **Maintenu** (période de grâce) |
| `unpaid` | Dunning **épuisé**, facture toujours impayée, l'abonnement existe encore mais Stripe **ne retente plus**. | Non | **Révoqué** |
| `canceled` | Abonnement terminé (état final). | Non | **Révoqué** |

Le passage `active` → `past_due` est **automatique** dès le premier échec. Ce qui se passe **après l'épuisement des retries** dépend d'un réglage (2.4).

### 2.4 Fin du dunning : que devient l'abonnement ?

Quand toutes les relances ont échoué, tu choisis dans le **Dashboard** (Settings → Billing → gestion des paiements échoués) l'un des trois comportements :

| Réglage | Effet | Event final typique |
|---------|-------|---------------------|
| **Annuler l'abonnement** | Passe en `canceled`. | `customer.subscription.deleted` |
| **Marquer impayé (`unpaid`)** | Passe en `unpaid` ; l'abonnement subsiste mais Stripe ne prélève plus. | `customer.subscription.updated` (status → `unpaid`) |
| **Laisser `past_due`** | Reste `past_due` indéfiniment, plus aucune relance. | `customer.subscription.updated` (dernier échec) |

**Pour TribuZen**, le choix par défaut recommandé est **annuler après le dunning** : c'est simple (retour Free via `customer.subscription.deleted`, déjà géré au module 03) et sans ambiguïté. Le point clé côté code : **la décision de révoquer l'accès se lit sur le statut de l'abonnement**, pas sur le premier `invoice.payment_failed`.

> **Où se décide la révocation ?** Sur `customer.subscription.updated`/`deleted` (statut passé à `unpaid` ou `canceled`) — module 03 et module 06 (mapping `status` → accès). `invoice.payment_failed` sert à **relancer** et **prévenir**, pas à couper.

### 2.5 SCA / 3D Secure sur un renouvellement

L'**authentification forte du client** (SCA — *Strong Customer Authentication*, réglementation européenne DSP2) impose, pour beaucoup de paiements par carte, que le client **valide** via **3D Secure (3DS)** (code SMS, appli bancaire…).

Le problème : un renouvellement d'abonnement est **off-session** (le client n'est pas devant son écran). Or 3DS demande une action **du client**. Deux cas :

- La banque **accepte sans challenge** (exemption, ou moyen de paiement enregistré `off_session` pour usage futur) → le paiement passe, rien de spécial.
- La banque **exige une authentification** → le paiement ne peut pas aboutir tout seul. Le `PaymentIntent` de la facture passe en **`requires_action`**, et Stripe émet le webhook **`invoice.payment_action_required`**.

Il faut alors **ramener le client** pour qu'il authentifie. La voie la plus simple : le lien de la **hosted invoice page** (`invoice.hosted_invoice_url`), une page Stripe où le client règle et valide le 3DS. On la lui envoie par email/notification.

> **Statuts de PaymentIntent à connaître :**
> - `requires_action` — une action du client est nécessaire (challenge 3DS à compléter).
> - `requires_payment_method` — le moyen de paiement a été refusé, il en faut un nouveau.

### 2.6 Emails de relance

Stripe peut **envoyer lui-même les emails de relance** au client (« votre paiement a échoué, mettez à jour votre carte ») — c'est configurable dans le Dashboard (Settings → Billing → emails). C'est le moyen le plus simple : zéro code d'emailing côté TribuZen.

Si tu veux des emails **sur mesure** (charte TribuZen, wording famille), tu les envoies toi-même **depuis le webhook** `invoice.payment_failed`, en incluant le lien `hosted_invoice_url` (ou un lien vers le Customer Portal, module 05, pour mettre à jour la carte). Les deux approches coexistent — ne pas doubler les emails si Stripe les envoie déjà.

### 2.7 Reproduire ces cas : cartes de test

Impossible d'attendre qu'une vraie carte expire. Stripe fournit des **cartes de test** (valeurs publiques) qui déclenchent des comportements précis en **mode test** :

| Carte de test | Comportement |
|---------------|--------------|
| `4242 4242 4242 4242` | Paiement **réussi** (référence). |
| `4000 0000 0000 0341` | **S'attache** au customer sans erreur, mais les **prélèvements suivants échouent** → parfait pour simuler un renouvellement qui rate et déclencher le dunning. |
| `4000 0025 0000 3155` | Requiert une **authentification 3DS pour les paiements off-session** (sauf si configurée pour usage futur) → simule `invoice.payment_action_required`. |
| `4000 0000 0000 0002` | **Refus générique** (`generic_decline`). |
| `4000 0000 0000 9995` | Refus pour **fonds insuffisants** (`insufficient_funds`). |

> Ce sont des numéros **de test publics** de `docs.stripe.com`, sans valeur réelle. Ils ne fonctionnent **que** avec une clé `sk_test_...`. Ne jamais les confondre avec une vraie carte, et ne jamais mettre de vraie carte dans du code ou un dépôt.

---

## 3. Worked examples

### Exemple 1 — Router `invoice.payment_failed` : marquer `past_due`, ne pas couper

On étend le service webhook du module 03. À l'échec, on marque `past_due` et on prévient — **sans** toucher au tier.

```ts
// src/billing/stripe-webhook.service.ts (extrait — suite du module 03)
import { Injectable, Logger } from '@nestjs/common'
import Stripe from 'stripe'
import { UsersService } from '../users/users.service'
import { DunningMailer } from './dunning.mailer'

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name)

  constructor(
    private readonly users: UsersService,
    private readonly mailer: DunningMailer,
  ) {}

  // Appelé depuis le switch du module 03 : case 'invoice.payment_failed'
  async onPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const user = await this.users.findByStripeCustomerId(invoice.customer as string)
    if (!user) return // idempotence : user disparu → on ne throw pas (module 03)

    // On NE coupe PAS Premium ici : le dunning est en cours, Stripe va retenter.
    // On marque past_due (le mapping status->accès du module 06 garde l'accès).
    await this.users.setSubscriptionStatus(user.id, 'past_due')

    // next_payment_attempt : timestamp (secondes) de la prochaine relance, ou null si fini.
    const willRetry = invoice.next_payment_attempt !== null
    const nextRetry = willRetry
      ? new Date(invoice.next_payment_attempt! * 1000) // Stripe = secondes → × 1000
      : null

    this.logger.warn(
      `Paiement échoué user=${user.id} tentative=${invoice.attempt_count} ` +
      `prochaine=${nextRetry?.toISOString() ?? 'aucune (dunning fini)'}`,
    )

    // Email de relance sur mesure (si on ne délègue pas les emails à Stripe) :
    // on inclut le lien hosted_invoice_url pour régler/mettre à jour la carte.
    if (invoice.hosted_invoice_url) {
      await this.mailer.sendPaymentFailed(user, {
        attempt: invoice.attempt_count,
        nextRetry,
        payUrl: invoice.hosted_invoice_url,
      })
    }
  }
}
```

Points clés :
- Aucune modification du `tier`. On passe `subscriptionStatus` à `past_due` — l'accès reste ouvert grâce au mapping du module 06.
- `next_payment_attempt === null` ⇒ Stripe ne retentera plus : le dunning touche à sa fin (la révocation viendra du changement de statut de l'abonnement, Exemple 2).
- `hosted_invoice_url` est le lien Stripe où le client règle sa facture (et valide un 3DS éventuel).

### Exemple 2 — Révoquer l'accès **au bon moment** : sur le statut de l'abonnement

La révocation ne se décide **jamais** sur `invoice.payment_failed`. Elle se décide quand l'abonnement passe en `unpaid`/`canceled` (fin du dunning). On réutilise le handler `customer.subscription.*` du module 03, avec le mapping statut → accès du module 06.

```ts
// src/billing/subscription-access.ts
import Stripe from 'stripe'

// Mapping explicite (module 06) : SEULS trialing/active donnent Premium.
// past_due = période de grâce → on GARDE l'accès pendant le dunning.
// unpaid / canceled = dunning épuisé → on RÉVOQUE.
const PREMIUM_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  'trialing',
  'active',
  'past_due', // ← grâce : accès maintenu tant que Stripe relance
])

export function shouldGrantPremium(status: Stripe.Subscription.Status): boolean {
  return PREMIUM_STATUSES.has(status)
}
```

```ts
// src/billing/stripe-webhook.service.ts (extrait — case customer.subscription.updated/deleted)
async onSubscriptionChanged(sub: Stripe.Subscription): Promise<void> {
  const user = await this.users.findByStripeCustomerId(sub.customer as string)
  if (!user) return

  const grant = shouldGrantPremium(sub.status)
  await this.users.updateSubscription(user.id, {
    subscriptionStatus: sub.status,          // 'past_due' | 'unpaid' | 'canceled' | ...
    tier: grant ? 'premium' : 'free',        // révocation ICI, sur le statut
  })

  // Transition past_due → unpaid/canceled = moment exact de la révocation.
  if (!grant) {
    // Email « ton accès Premium est suspendu, régularise pour le réactiver »
  }
}
```

Ce qu'il illustre : `past_due` est traité comme **une période de grâce** (accès maintenu). La bascule vers `unpaid` ou `canceled` — décidée par Stripe à la fin du dunning selon le réglage 2.4 — est le **seul** point où on coupe Premium.

### Exemple 3 — SCA/3DS sur renouvellement : `invoice.payment_action_required`

Quand un renouvellement exige une authentification 3DS, Stripe émet `invoice.payment_action_required`. On ne peut pas authentifier à la place du client : on le **ramène** vers la hosted invoice page.

```ts
// Dans le switch webhook (module 03) : case 'invoice.payment_action_required'
async onPaymentActionRequired(invoice: Stripe.Invoice): Promise<void> {
  const user = await this.users.findByStripeCustomerId(invoice.customer as string)
  if (!user) return

  // Le PaymentIntent de la facture est en requires_action : le client doit valider (3DS).
  // On NE révoque pas : l'abonnement peut rester actif, on attend l'authentification.
  await this.users.setSubscriptionStatus(user.id, 'past_due')

  // hosted_invoice_url = page Stripe où le client authentifie + règle.
  if (invoice.hosted_invoice_url) {
    await this.mailer.sendActionRequired(user, {
      authUrl: invoice.hosted_invoice_url, // « valide ton paiement en 1 clic »
    })
  }
  // Une fois le client authentifié → invoice.paid + customer.subscription.updated
  // (status active) → le mapping re-accorde Premium automatiquement.
}
```

Le flux se referme tout seul : le client clique le lien, valide le 3DS sur la page Stripe, la facture passe `paid`, et le webhook `customer.subscription.updated` (status `active`) réactive l'accès via le mapping de l'Exemple 2.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Couper Premium dès `invoice.payment_failed`

```ts
// ❌ Un seul échec (carte expirée) → accès coupé immédiatement
case 'invoice.payment_failed':
  await this.users.updateTier(userId, 'free') // client fidèle viré pour une relance à venir
```

`invoice.payment_failed` signifie « une tentative a échoué, **le dunning commence** », pas « c'est fini ». Stripe va retenter (par défaut 8 fois sur 2 semaines) et emailer le client. On marque `past_due` (grâce), on relance, et on ne coupe qu'à la **fin** du dunning (`unpaid`/`canceled`).

### PIÈGE #2 — Confondre `past_due` et `unpaid`

`past_due` = dunning **en cours**, Stripe **retente encore**, accès maintenu (grâce). `unpaid` = dunning **épuisé**, Stripe **ne retente plus**, accès à révoquer. Traiter les deux pareil, c'est soit couper trop tôt (`past_due` traité comme `unpaid`), soit ne jamais couper (`unpaid` traité comme `past_due`). Le mapping doit les distinguer explicitement.

### PIÈGE #3 — Réinventer le dunning avec un cron maison

```ts
// ❌ Cron perso qui retente le paiement tous les 3 jours + emails maison
```

Stripe fait déjà les smart retries (timing optimisé par apprentissage), les emails de relance, et gère les codes de decline non-retryable. Réimplémenter tout ça, c'est du code fragile pour un résultat inférieur. On configure le dunning dans le Dashboard et on **réagit** aux webhooks.

### PIÈGE #4 — Croire que 3DS peut se valider côté serveur

L'authentification 3DS exige une action **du client** (code, appli bancaire). Sur un renouvellement off-session, tu ne peux pas la faire à sa place. Le seul chemin : recevoir `invoice.payment_action_required` et **renvoyer le client** vers `hosted_invoice_url` (ou l'authentifier via Elements côté front avec le `client_secret` du PaymentIntent). Ignorer cet event = paiements bloqués en `requires_action` que tu ne récupères jamais.

### PIÈGE #5 — Retenter à l'identique un decline non-retryable

```ts
// ❌ Carte volée / numéro incorrect / authentication_required → retenter la MÊME carte
```

Certains codes (`lost_card`, `stolen_card`, `incorrect_number`, `authentication_required`…) ne passeront **jamais** en réessayant à l'identique. Il faut un **nouveau moyen de paiement** (mise à jour via Customer Portal, module 05) — ou, pour `authentication_required`, une authentification 3DS. Stripe le sait ; ton rôle est de pousser le client à mettre à jour sa carte, pas de marteler la même.

### PIÈGE #6 — Tester avec `4242` pour un échec

`4242 4242 4242 4242` réussit **toujours** : impossible de tester le dunning avec. Pour simuler un renouvellement qui échoue, il faut `4000 0000 0000 0341` (s'attache mais les charges suivantes échouent). Pour un challenge 3DS off-session : `4000 0025 0000 3155`. Utiliser la mauvaise carte de test = « ça marche toujours, je ne reproduis jamais l'échec ».

### PIÈGE #7 — `next_payment_attempt` traité comme des millisecondes

```ts
// ❌ next_payment_attempt est un timestamp Unix en SECONDES
new Date(invoice.next_payment_attempt)        // date en 1970
// ✅
new Date(invoice.next_payment_attempt * 1000) // × 1000
```

Comme tous les timestamps Stripe (module 04). Et attention : `next_payment_attempt` peut être **`null`** (plus de relance prévue) — toujours tester la nullité avant de multiplier.

---

## 5. Ancrage TribuZen

Le dunning est la **filet de sécurité revenu** de TribuZen Premium : il récupère les paiements échoués (cartes expirées, refus temporaires) sans virer les familles fidèles ni offrir Premium gratis.

Parcours réel — « la carte de la famille Martin expire » :

1. **Renouvellement annuel** : Stripe prélève off-session → **échec** (carte expirée). Webhook `invoice.payment_failed`, `attempt_count: 1`.
2. TribuZen passe la famille en **`past_due`** → **accès Premium maintenu** (grâce, mapping module 06). Email de relance avec `hosted_invoice_url`.
3. **Smart retries** : Stripe retente (8 fois / 2 semaines par défaut), réémet `invoice.payment_failed` à chaque échec avec `attempt_count` incrémenté.
4. **Cas A — le parent met à jour sa carte** (via Customer Portal, module 05) et un retry passe : `invoice.paid` + `customer.subscription.updated` (status `active`) → statut nettoyé, accès conservé. Fin heureuse.
5. **Cas B — 3DS requis** : un retry déclenche `invoice.payment_action_required` → email « valide ton paiement » avec le lien Stripe → le parent authentifie → `invoice.paid`.
6. **Cas C — dunning épuisé sans paiement** : Stripe applique le réglage de fin (annulation) → `customer.subscription.deleted` (ou status `unpaid`) → TribuZen **révoque Premium** (retour Free). C'est le **seul** moment de coupure.

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen-api/
  src/
    billing/
      stripe-webhook.service.ts   ← onPaymentFailed, onPaymentActionRequired (+ module 03)
      subscription-access.ts      ← mapping status->accès (past_due = grâce, unpaid/canceled = révoque)
      dunning.mailer.ts           ← emails de relance sur mesure (ou délégués à Stripe)
```

> Le mapping `status` → droit d'accès vient du **module 06** (feature gating). Ce module 07 ajoute juste la nuance clé : **`past_due` = période de grâce (accès maintenu)**, et la révocation se lit sur `unpaid`/`canceled`, jamais sur le premier échec.

---

## 6. Points clés

1. Un renouvellement qui échoue émet **`invoice.payment_failed`** et passe l'abonnement en **`past_due`** ; on **ne coupe pas** Premium à ce moment.
2. Le **dunning** (smart retries) est géré par Stripe : par défaut **8 tentatives sur 2 semaines**, configurable dans le Dashboard, avec emails de relance optionnels.
3. L'`Invoice` porte `attempt_count` (tentatives faites) et `next_payment_attempt` (prochaine relance, `null` = fini, timestamp en **secondes**).
4. `past_due` = dunning en cours (**accès maintenu, grâce**) ; `unpaid` = dunning épuisé, plus de relance (**révoquer**) ; `canceled` = terminé (**révoquer**).
5. Le comportement de **fin de dunning** (`canceled` / `unpaid` / `past_due`) se choisit dans le **Dashboard** ; pour TribuZen, annuler est le défaut simple.
6. La **révocation d'accès** se décide sur le **statut de l'abonnement** (`unpaid`/`canceled` via `customer.subscription.*`), jamais sur `invoice.payment_failed`.
7. **SCA/3DS** sur renouvellement : le `PaymentIntent` passe `requires_action`, Stripe émet **`invoice.payment_action_required`** ; on ramène le client via `hosted_invoice_url` (on ne peut pas authentifier côté serveur).
8. Certains **declines sont non-retryable** (`lost_card`, `authentication_required`…) : il faut un **nouveau moyen de paiement**, pas une relance à l'identique.
9. **Cartes de test** : `4000 0000 0000 0341` (échec sur charges suivantes → dunning), `4000 0025 0000 3155` (3DS off-session) ; `4242...` réussit toujours et ne teste **pas** l'échec.

---

## 7. Seeds Anki

```
Que fait-on à la réception de invoice.payment_failed pour un abonnement TribuZen ?|On passe l'abonnement en past_due (période de grâce, accès MAINTENU) et on relance le client. On ne coupe PAS Premium : le dunning (smart retries) commence, Stripe va retenter.
Différence entre past_due et unpaid ?|past_due = dunning en cours, Stripe retente encore, accès maintenu (grâce). unpaid = dunning épuisé, Stripe ne retente plus, accès à révoquer. Il faut les mapper différemment.
Qu'est-ce que le dunning / smart retries chez Stripe ?|La relance automatique des paiements échoués. Smart Retries = Stripe choisit le meilleur moment (modèle appris), par défaut 8 tentatives sur 2 semaines, configurable dans le Dashboard, avec emails de relance optionnels.
À quoi servent attempt_count et next_payment_attempt sur une Invoice ?|attempt_count = nombre de tentatives déjà faites. next_payment_attempt = timestamp (secondes) de la prochaine relance, ou null si Stripe ne retentera plus (dunning fini).
Sur quel signal révoque-t-on l'accès Premium après des échecs ?|Sur le STATUT de l'abonnement passé à unpaid ou canceled (via customer.subscription.updated/deleted), à la fin du dunning. JAMAIS sur invoice.payment_failed (qui ne fait que relancer/prévenir).
Que se passe-t-il quand un renouvellement off-session exige une authentification 3DS ?|Le PaymentIntent passe requires_action et Stripe émet invoice.payment_action_required. On ne peut pas authentifier côté serveur : on ramène le client via hosted_invoice_url pour qu'il valide le 3DS.
Quelle carte de test simule un renouvellement qui échoue (dunning) ?|4000 0000 0000 0341 : elle s'attache au customer sans erreur mais les prélèvements suivants échouent. 4242... réussit toujours et ne permet PAS de tester l'échec.
Quelle carte de test déclenche un challenge 3DS off-session ?|4000 0025 0000 3155 : requiert une authentification 3DS pour les paiements off-session (sauf si configurée pour usage futur). Simule invoice.payment_action_required.
Pourquoi ne pas retenter à l'identique un decline lost_card ou authentication_required ?|Ce sont des codes non-retryable : la même carte ne passera jamais en réessayant. Il faut un nouveau moyen de paiement (Customer Portal) ou une authentification 3DS.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-07-paiements-echoues-et-dunning/README.md`. Reproduire un paiement de renouvellement échoué et un challenge 3DS avec les cartes de test Stripe (mode test, `stripe listen`), maintenir Premium en `past_due` puis le révoquer au bon moment. Vrai SDK Stripe, zéro harnais simulé, corrigé complet commenté.
