# Lab 04 — Subscriptions et cycle de vie

> **Outcome :** à la fin, tu sais faire un upgrade (mensuel → annuel) et une annulation (fin de période + reprise) d'un abonnement **TribuZen Premium** via le vrai SDK Stripe en mode test, et observer les changements de statut via les webhooks.
> **Vrai outil :** SDK `stripe` (Node) en **mode test** + **Stripe CLI** (`stripe listen`, `stripe trigger`, cartes de test `4242 4242 4242 4242`). JAMAIS de harnais simulé.
> **Feedback :** le coach valide en session (pas de test-runner auto-correcteur).

> **⚠️ Sécurité clés Stripe.** Aucune vraie clé dans ce repo. Les clés vivent dans un `.env` **jamais commité** (`.gitignore` : `.env`, `node_modules`). Dans tout fichier suivi par git, n'écris que des placeholders cassés type `sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>` et `whsec_<SECRET-WEBHOOK-EXEMPLE>`. Le `<` casse volontairement le pattern de détection de secret. Ne colle JAMAIS une clé réelle, même en test.

---

## Énoncé

Tu pilotes le cycle de vie d'un abonnement TribuZen Premium **entièrement via le SDK**, en observant chaque changement d'état arriver par webhook (comme en prod). Tu dois, dans l'ordre :

1. **Créer** un customer + un abonnement Premium **mensuel** avec un essai de 14 jours (statut `trialing`).
2. **Upgrade** cet abonnement du prix **mensuel** au prix **annuel**, en facturant le différentiel immédiatement (`proration_behavior: 'always_invoice'`).
3. **Annuler** l'abonnement **en fin de période** (`cancel_at_period_end: true`) — l'accès doit rester actif.
4. **Reprendre** l'abonnement (`cancel_at_period_end: false`).
5. Pour chaque étape, **lire l'event webhook** correspondant dans le terminal `stripe listen` et vérifier le `status` / `cancel_at_period_end`.

### Pré-requis matériel

- Un compte Stripe (mode **test**), deux Prices récurrents créés au module 01 : un mensuel, un annuel (le SDK n'invente pas de prix — utilise ceux du Dashboard test).
- Stripe CLI installée et `stripe login` effectué.

### Starter minimal

Crée un dossier de lab hors du repo de cours (ou dans un `.gitignore`-é), `npm init -y`, `npm i stripe`, puis un `.env` **non commité** :

```bash
# .env — NE JAMAIS COMMITTER (ajoute-le à .gitignore)
STRIPE_SECRET_KEY=sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>
STRIPE_PRICE_PREMIUM_MONTHLY=price_<TON-PRIX-MENSUEL-TEST>
STRIPE_PRICE_PREMIUM_YEARLY=price_<TON-PRIX-ANNUEL-TEST>
```

```js
// lifecycle.js — starter (tu complètes les TODO)
import 'dotenv/config'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

async function main() {
  // TODO 1 : créer un customer de test + un abonnement mensuel avec trial 14 j
  // TODO 2 : upgrade vers l'annuel (always_invoice)
  // TODO 3 : annuler en fin de période
  // TODO 4 : reprendre
  // Log le status et cancel_at_period_end après chaque étape.
}

main().catch(console.error)
```

Dans un **second terminal**, lance l'écoute des webhooks AVANT d'exécuter le script :

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
# ou, si tu n'as pas de serveur : stripe listen --print-json
```

**Pas de gap-fill.** Tu écris le script complet à partir du starter.

---

## Étapes (en friction)

1. **Crée le customer** : `stripe.customers.create({ email: 'martin@tribuzen.test' })`. Note l'`id` (`cus_...`).
2. **Attache un moyen de paiement de test** : le plus simple est de créer l'abonnement via une Checkout Session en `mode: 'subscription'` (module 02) et payer avec `4242 4242 4242 4242`. Alternative rapide sans UI : attache le PaymentMethod de test `pm_card_visa` au customer et mets-le en `invoice_settings.default_payment_method`.
3. **Crée l'abonnement mensuel avec essai** : `subscriptions.create({ customer, items: [{ price: MONTHLY }], trial_period_days: 14 })`. Vérifie `status === 'trialing'`.
4. **Upgrade vers l'annuel** : `retrieve` l'abonnement, lis `items.data[0].id`, puis `update` avec cet `id` + le prix annuel + `proration_behavior: 'always_invoice'`. **Ne pas oublier l'`id`** (piège #1 du module).
5. **Annule en fin de période** : `update({ cancel_at_period_end: true })`. Vérifie que `status` reste `active`/`trialing` et que `cancel_at_period_end === true`.
6. **Reprends** : `update({ cancel_at_period_end: false })`. Vérifie `cancel_at_period_end === false`.
7. **Observe les webhooks** : dans le terminal `stripe listen`, repère `customer.subscription.created`, `customer.subscription.updated` (upgrade, puis annulation programmée, puis reprise). Identifie lequel change quoi.
8. **Bonus friction** : simule la fin d'essai avec `stripe trigger customer.subscription.trial_will_end` et vérifie que l'event arrive.

---

## Corrigé complet commenté

```js
// lifecycle.js — corrigé
import 'dotenv/config'
import Stripe from 'stripe'

// La clé vient de .env (jamais commité). Ici : placeholder cassé.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const MONTHLY = process.env.STRIPE_PRICE_PREMIUM_MONTHLY
const YEARLY = process.env.STRIPE_PRICE_PREMIUM_YEARLY

// Petit helper pour logger l'état saillant après chaque étape
function logState(label, sub) {
  console.log(
    `[${label}] status=${sub.status} ` +
      `cancel_at_period_end=${sub.cancel_at_period_end} ` +
      `price=${sub.items.data[0].price.id} ` +
      `period_end=${new Date(sub.items.data[0].current_period_end * 1000).toISOString()}`,
  )
}

async function main() {
  // ── 1. Customer + moyen de paiement de test ──────────────────────────────
  const customer = await stripe.customers.create({
    email: 'martin@tribuzen.test',
    name: 'Famille Martin',
  })

  // Attache un PaymentMethod de test et le rend défaut (sinon pas de facturation
  // à la fin de l'essai → l'abonnement passerait paused/canceled).
  const pm = await stripe.paymentMethods.attach('pm_card_visa', {
    customer: customer.id,
  })
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: pm.id },
  })

  // ── 2. Abonnement mensuel avec essai 14 jours ────────────────────────────
  let sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: MONTHLY }],
    trial_period_days: 14, // → statut 'trialing'
  })
  logState('created', sub) // status=trialing

  // ── 3. Upgrade mensuel → annuel, facturé immédiatement ───────────────────
  // CRUCIAL : passer l'id de l'item existant (si_...) pour REMPLACER le prix.
  // Sans cet id, Stripe AJOUTE un second item → double facturation.
  const currentItemId = sub.items.data[0].id
  sub = await stripe.subscriptions.update(sub.id, {
    items: [{ id: currentItemId, price: YEARLY }],
    proration_behavior: 'always_invoice', // facture le différentiel tout de suite
  })
  logState('upgraded', sub) // price = annuel

  // ── 4. Annulation EN FIN DE PÉRIODE ──────────────────────────────────────
  // L'accès reste honoré jusqu'à current_period_end. status NE change PAS.
  sub = await stripe.subscriptions.update(sub.id, {
    cancel_at_period_end: true,
  })
  logState('cancel-scheduled', sub) // status inchangé, cancel_at_period_end=true

  // ── 5. Reprise (annuler l'annulation) ────────────────────────────────────
  // Possible car l'abonnement n'est PAS encore 'canceled'.
  sub = await stripe.subscriptions.update(sub.id, {
    cancel_at_period_end: false,
  })
  logState('resumed', sub) // cancel_at_period_end=false

  // ── (Optionnel) Annulation IMMÉDIATE — état final, non reprenable ─────────
  // const canceled = await stripe.subscriptions.cancel(sub.id)
  // logState('canceled-now', canceled) // status=canceled, event .deleted immédiat
}

main().catch((e) => {
  console.error('Erreur :', e.message)
  process.exit(1)
})
```

**Ce que tu dois voir dans le terminal `stripe listen` (ordre) :**

```
customer.subscription.created     ← statut trialing
customer.subscription.updated     ← upgrade (le price change dans items)
customer.subscription.updated     ← cancel_at_period_end passe à true
customer.subscription.updated     ← cancel_at_period_end repasse à false
```

**Pourquoi ce corrigé est correct :**
- L'upgrade passe `items: [{ id, price }]` — le prix est **remplacé**, pas ajouté (piège #1 du module).
- L'annulation en fin de période émet `customer.subscription.updated` (pas `.deleted`) et **ne change pas le statut** — c'est bien `cancel_at_period_end` qu'on lit pour l'UI, pas le statut.
- La reprise fonctionne car l'abonnement n'est jamais passé `canceled`. L'annulation immédiate (commentée) serait un état final non reprenable.
- Tous les timestamps sont convertis avec `× 1000` (secondes → millisecondes).

---

## Variante J+30 (fading)

**Même parcours, contraintes ajoutées, sans rouvrir ce corrigé ni le module :**

1. Reproduis les 5 étapes **de mémoire, en 30 minutes**.
2. Ajoute un **downgrade** annuel → mensuel avec `proration_behavior: 'none'` (le changement s'applique au prochain cycle, sans ajustement financier immédiat) — et explique à voix haute au coach pourquoi `none` plutôt que `always_invoice` sur un downgrade.
3. Après avoir programmé l'annulation en fin de période, écris une fonction `describeState(sub)` qui retourne la phrase d'UI exacte : soit `Renouvellement le <date>`, soit `Se termine le <date>` selon `cancel_at_period_end`.

**Critère de réussite :** les events attendus apparaissent dans `stripe listen`, le downgrade ne génère pas de facture immédiate, et `describeState` distingue correctement les deux cas.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ce cycle de vie vit côté back-office NestJS :

```
tribuzen/
  src/
    billing/
      subscription.service.ts    ← switchToYearly, cancelAtPeriodEnd, resume
      subscription-tier.ts       ← mapping statut → droit d'accès (trialing/active = premium)
      stripe-webhook.service.ts  ← persiste les changements à la réception des webhooks
```

**Différences par rapport au lab :**

- Les actions ne modifient **jamais** la base directement à partir du retour SDK. La base est mise à jour **uniquement** à la réception de `customer.subscription.updated` / `.deleted` (module 03) — source de vérité unique.
- En production TribuZen, l'utilisateur déclenche upgrade/annulation via le **Customer Portal** Stripe (module 05), qui appelle ces mêmes API sous le capot. Ce lab est le socle SDK qui explique ce que le portail automatise.
- Les Price IDs viennent de la config d'environnement, jamais en dur.

**Commit cible :**
```
feat(billing): cycle de vie abonnement — upgrade proraté, annulation fin de période, reprise
```
