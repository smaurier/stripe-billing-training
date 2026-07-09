# Lab 07 — Paiements échoués et dunning (3DS + révocation)

> **Outcome :** à la fin, tu sais gérer un renouvellement d'abonnement qui échoue avec le vrai SDK Stripe en mode test — maintenir Premium en `past_due` pendant le dunning, gérer un challenge 3DS via `invoice.payment_action_required`, et révoquer Premium au bon moment (à `unpaid`/`canceled`).
> **Vrai outil :** SDK `stripe` (Node) + Stripe CLI (`stripe listen`, `stripe trigger`) en **mode test** + cartes de test publiques Stripe. JAMAIS un harnais simulé.
> **Feedback :** le coach valide en session à partir de la grille ci-dessous — pas de test-runner auto-correcteur.

> **⚠️ Sécurité clés.** Tes clés Stripe (`sk_test_...`, `whsec_...`) vivent dans un `.env` **jamais commité** (vérifie ton `.gitignore`). Le code du dépôt ne montre que des placeholders cassés type `sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>`. Les **cartes de test** (`4242...`, `4000 0000 0000 0341`, `4000 0025 0000 3155`) sont des **valeurs publiques** de la doc Stripe — pas des secrets — mais elles ne fonctionnent qu'avec une clé `sk_test_...`.

---

## Prérequis

- Compte Stripe en **mode test**, Stripe CLI installée et `stripe login` fait.
- L'endpoint webhook signé et idempotent du **lab 03** qui tourne (NestJS ou un petit serveur Express : peu importe, tant que la signature est vérifiée avec `constructEvent` sur le raw body).
- Le mapping `status` → accès du **module 06** disponible (ou tu le recopies ici).
- `stripe listen --forward-to localhost:PORT/webhooks/stripe` actif dans un terminal (il te donne le `whsec_...` de test à mettre dans `.env`).

---

## Énoncé

Tu ajoutes à ton back-office billing la gestion **complète** d'un renouvellement TribuZen Premium qui échoue. Cahier des charges **exact** :

1. **Router `invoice.payment_failed`** : passer l'utilisateur en `past_due` **sans couper Premium**, logguer `attempt_count` et `next_payment_attempt` (converti en date lisible, en gérant le `null`).
2. **Mapping d'accès** : `trialing` / `active` / `past_due` → Premium (grâce) ; `unpaid` / `canceled` → Free (révoqué). La révocation se lit sur `customer.subscription.updated`/`deleted`, **jamais** sur `invoice.payment_failed`.
3. **Router `invoice.payment_action_required`** (3DS off-session) : rester `past_due`, exposer le lien `hosted_invoice_url` (log ou email) pour que le client authentifie.
4. **Reproduire réellement les scénarios** avec les cartes de test et observer les webhooks arriver via `stripe listen`.

**Pas de gap-fill.** Tu écris les handlers à partir du starter minimal. Le point pédagogique est de **voir les vrais events arriver** et de vérifier que ton accès bascule au bon moment.

### Cartes de test à utiliser (valeurs publiques Stripe)

| Carte | Rôle dans le lab |
|-------|------------------|
| `4242 4242 4242 4242` | Référence qui réussit (renouvellement OK). |
| `4000 0000 0000 0341` | S'attache au customer mais les **charges suivantes échouent** → déclenche le dunning. |
| `4000 0025 0000 3155` | Requiert **3DS off-session** → déclenche `invoice.payment_action_required`. |

### Starter minimal

`src/billing/failed-payment.handler.ts` (à compléter) :

```ts
import Stripe from 'stripe'

// process.env.STRIPE_SECRET_KEY = 'sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>' (dans .env)
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

// Remplace par ton vrai UsersService — ici une abstraction minimale
interface Users {
  findByStripeCustomerId(cus: string): Promise<{ id: string } | null>
  setSubscriptionStatus(userId: string, status: Stripe.Subscription.Status): Promise<void>
  updateSubscription(userId: string, patch: { subscriptionStatus: Stripe.Subscription.Status; tier: 'free' | 'premium' }): Promise<void>
}

// TODO 1 : mapping status -> Premium ? (past_due = grâce)
export function shouldGrantPremium(status: Stripe.Subscription.Status): boolean {
  // à écrire
  return false
}

// TODO 2 : invoice.payment_failed -> past_due, log attempt_count/next_payment_attempt, NE PAS couper
export async function onPaymentFailed(users: Users, invoice: Stripe.Invoice): Promise<void> {
  // à écrire
}

// TODO 3 : invoice.payment_action_required -> rester past_due, exposer hosted_invoice_url
export async function onPaymentActionRequired(users: Users, invoice: Stripe.Invoice): Promise<void> {
  // à écrire
}

// TODO 4 : customer.subscription.updated/deleted -> révoquer si !shouldGrantPremium(status)
export async function onSubscriptionChanged(users: Users, sub: Stripe.Subscription): Promise<void> {
  // à écrire
}
```

Branche ces handlers dans le `switch (event.type)` de ton endpoint webhook (lab 03) : `invoice.payment_failed`, `invoice.payment_action_required`, `customer.subscription.updated`, `customer.subscription.deleted`.

---

## Étapes (en friction)

1. **Écris `shouldGrantPremium`** — `Set` avec `trialing`, `active`, `past_due`. Tout le reste (`unpaid`, `canceled`, `incomplete`…) → `false`.
2. **Écris `onPaymentFailed`** — retrouver le user par `invoice.customer`, `if (!user) return`, passer `past_due`, calculer la date de prochaine relance (`next_payment_attempt` en secondes `× 1000`, gérer `null`), logguer `attempt_count` + la date. **Ne touche pas au tier.**
3. **Écris `onPaymentActionRequired`** — `past_due` + log/expose `invoice.hosted_invoice_url` (le lien où le client valide le 3DS). Ne révoque pas.
4. **Écris `onSubscriptionChanged`** — lire `sub.status`, `tier = shouldGrantPremium(status) ? 'premium' : 'free'`, persister. C'est **ici** que la révocation arrive quand le statut passe `unpaid`/`canceled`.
5. **Reproduis le dunning** :
   - Crée un customer + un abonnement TribuZen Premium en test avec la carte `4000 0000 0000 0341` (elle s'attache, mais le prélèvement de facture échoue).
   - Le plus simple pour forcer une facture immédiate : un prix mensuel court, ou déclenche une facture. Observe dans le terminal `stripe listen` l'arrivée de `invoice.payment_failed`. Vérifie que ton user passe `past_due` **et garde Premium**.
6. **Reproduis le 3DS** : refais un abonnement avec `4000 0025 0000 3155`. Observe `invoice.payment_action_required` arriver ; vérifie que tu logges bien `hosted_invoice_url` et que l'accès n'est **pas** coupé.
7. **Reproduis la révocation** : simule la fin du dunning. Le plus direct en test : `stripe trigger customer.subscription.updated` (ou annule l'abonnement dans le Dashboard test pour émettre `customer.subscription.deleted`). Vérifie que quand le statut arrive `unpaid`/`canceled`, ton user repasse **Free**.
8. **Vérifie l'idempotence** (lab 03) : rejoue le même event (Stripe CLI permet de renvoyer) → l'accès ne doit pas changer deux fois de façon incohérente.

> Astuce : `stripe trigger invoice.payment_failed` envoie un event de test tout fait — pratique pour câbler le routage vite. Mais fais **au moins une fois** le scénario complet avec la carte `4000 0000 0000 0341` pour voir le vrai enchaînement `attempt_count` / `next_payment_attempt`.

---

## Corrigé complet commenté

```ts
// src/billing/failed-payment.handler.ts — corrigé
import Stripe from 'stripe'

// La clé vit dans .env (jamais commité). Placeholder cassé dans le dépôt :
// STRIPE_SECRET_KEY=sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

interface Users {
  findByStripeCustomerId(cus: string): Promise<{ id: string } | null>
  setSubscriptionStatus(userId: string, status: Stripe.Subscription.Status): Promise<void>
  updateSubscription(
    userId: string,
    patch: { subscriptionStatus: Stripe.Subscription.Status; tier: 'free' | 'premium' },
  ): Promise<void>
}

// --- TODO 1 : mapping status -> accès Premium ---
// past_due est INCLUS : c'est la période de grâce pendant le dunning.
// unpaid / canceled / incomplete / incomplete_expired / paused -> pas d'accès.
const PREMIUM_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  'trialing',
  'active',
  'past_due',
])

export function shouldGrantPremium(status: Stripe.Subscription.Status): boolean {
  return PREMIUM_STATUSES.has(status)
}

// --- TODO 2 : invoice.payment_failed ---
export async function onPaymentFailed(users: Users, invoice: Stripe.Invoice): Promise<void> {
  const user = await users.findByStripeCustomerId(invoice.customer as string)
  if (!user) return // idempotence : user disparu -> pas d'erreur (lab 03)

  // On marque past_due : le dunning commence. Le mapping ci-dessus GARDE l'accès.
  // On ne touche PAS au tier ici — couper maintenant virerait un client qui va payer.
  await users.setSubscriptionStatus(user.id, 'past_due')

  // next_payment_attempt : timestamp Unix en SECONDES, ou null si plus de relance.
  const nextRetry =
    invoice.next_payment_attempt !== null
      ? new Date(invoice.next_payment_attempt * 1000) // × 1000 : secondes -> ms
      : null

  console.warn(
    `[dunning] user=${user.id} tentative=${invoice.attempt_count} ` +
      `prochaine=${nextRetry?.toISOString() ?? 'aucune (dunning terminé)'} ` +
      `payUrl=${invoice.hosted_invoice_url ?? 'n/a'}`,
  )
  // En vrai produit : envoyer l'email de relance avec invoice.hosted_invoice_url
  // (sauf si on délègue les emails de relance à Stripe via le Dashboard).
}

// --- TODO 3 : invoice.payment_action_required (SCA / 3DS off-session) ---
export async function onPaymentActionRequired(users: Users, invoice: Stripe.Invoice): Promise<void> {
  const user = await users.findByStripeCustomerId(invoice.customer as string)
  if (!user) return

  // Le PaymentIntent de la facture est en requires_action : SEUL le client peut valider le 3DS.
  // On reste past_due (accès maintenu) et on lui envoie le lien d'authentification.
  await users.setSubscriptionStatus(user.id, 'past_due')

  console.warn(
    `[3ds] user=${user.id} authentification requise -> ${invoice.hosted_invoice_url ?? 'n/a'}`,
  )
  // En vrai produit : email « valide ton paiement » avec invoice.hosted_invoice_url.
  // Après validation : invoice.paid + customer.subscription.updated(active) -> accès re-accordé.
}

// --- TODO 4 : customer.subscription.updated / deleted : LA révocation se décide ici ---
export async function onSubscriptionChanged(users: Users, sub: Stripe.Subscription): Promise<void> {
  const user = await users.findByStripeCustomerId(sub.customer as string)
  if (!user) return

  const grant = shouldGrantPremium(sub.status)
  await users.updateSubscription(user.id, {
    subscriptionStatus: sub.status,        // 'past_due' | 'unpaid' | 'canceled' | ...
    tier: grant ? 'premium' : 'free',      // révocation ICI, sur le statut de l'abonnement
  })

  if (!grant) {
    console.warn(`[révocation] user=${user.id} Premium coupé (status=${sub.status})`)
    // Email « ton accès Premium est suspendu, régularise pour le réactiver ».
  }
}
```

**Pourquoi ce corrigé est correct :**
- `invoice.payment_failed` **ne coupe rien** : il marque `past_due` (grâce) et relance. C'est le cœur du dunning — laisser à Stripe le temps de retenter.
- La **révocation** est centralisée dans `onSubscriptionChanged`, sur le **statut** de l'abonnement. `past_due` garde l'accès ; `unpaid`/`canceled` le coupe. Un seul endroit, une seule règle.
- Le 3DS off-session ne peut **pas** être résolu côté serveur : on expose `hosted_invoice_url` et on attend que le client authentifie. L'event `invoice.paid` refermera le flux via `onSubscriptionChanged`.
- `next_payment_attempt` est traité en secondes (`× 1000`) **et** son cas `null` (dunning fini) est géré — deux pièges classiques évités.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, en 30 minutes, sans rouvrir ce corrigé ni le module 07 :**

1. Ajoute un **compteur de relances** : après `attempt_count >= 3` échecs, envoie un email de relance « urgent » différent (log distinct suffit pour le lab).
2. Gère explicitement le cas **`requires_payment_method`** (moyen de paiement définitivement refusé) : au lieu de juste relancer, pousse le client vers le **Customer Portal** (module 05) pour **changer de carte** — un lien différent de la simple hosted invoice page.
3. Reproduis un scénario avec un decline **non-retryable** (`4000 0000 0000 0002`, generic decline) et vérifie ton wording : ne pas promettre « on va retenter » si le code ne le permet pas.

**Critère de réussite :** l'accès Premium ne se coupe jamais sur un simple `invoice.payment_failed`, se maintient pendant tout le dunning en `past_due`, et bascule Free **exactement** quand le statut passe `unpaid`/`canceled` — vérifié en observant les webhooks réels dans `stripe listen`.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ces handlers vivent ici :

```
tribuzen-api/
  src/
    billing/
      stripe-webhook.service.ts   ← onPaymentFailed, onPaymentActionRequired, onSubscriptionChanged
      subscription-access.ts      ← shouldGrantPremium (past_due = grâce)
      dunning.mailer.ts           ← emails de relance (ou délégués à Stripe via Dashboard)
```

**Différences par rapport au lab :**

- `Users` est le vrai `UsersService` (Postgres via module 10 du parcours), pas l'interface minimale.
- Les emails de relance passent par le mailer TribuZen (ou sont délégués à Stripe dans le Dashboard test → prod).
- Le comportement de **fin de dunning** (annuler / `unpaid` / rester `past_due`) est configuré une fois dans le **Dashboard** Stripe, pas dans le code.
- Le marquage `past_due`/révocation partage la même table `users` que le mapping du module 06.

**Commit cible :**
```
feat(billing): gérer paiements échoués — dunning past_due, 3DS action_required, révocation à unpaid/canceled
```
