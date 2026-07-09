---
titre: Stripe Products & Prices — le catalogue de facturation
cours: 22-stripe-billing
notions: ["Product vs Price", "one-time vs recurring vs usage-based", "recurring.interval (month/year)", "Customer", "Subscription", "Invoice", "création via SDK Node", "unit_amount en cents", "immutabilité des Price", "Price IDs en ENV"]
outcomes:
  - sait distinguer un Product (le quoi) d'un Price (le combien) et expliquer pourquoi ils sont séparés
  - sait choisir entre les 3 modèles de facturation (one-time, recurring, usage-based) selon le besoin produit
  - sait créer un Product et ses Prices via le SDK Node stripe en mode test
  - sait situer les entités Customer, Subscription et Invoice dans le cycle de facturation
prerequis: [00-introduction-au-billing-saas]
next: 02-stripe-checkout-et-payment-links
libs: [{ name: stripe, version: "^17" }]
tribuzen: back-office facturation TribuZen — catalogue "TribuZen Premium" (abonnement famille mensuel/annuel) créé dans Stripe en mode test
last-reviewed: 2026-07
---

# Stripe Products & Prices — le catalogue de facturation

> **Outcomes — tu sauras FAIRE :** distinguer Product et Price, choisir un modèle de facturation, créer un Product et ses Prices via le SDK Node en mode test, situer Customer/Subscription/Invoice.
> **Difficulté :** :star::star:

## 1. Cas concret d'abord

TribuZen passe en freemium → premium. Le produit doit vendre **TribuZen Premium**, un abonnement famille, avec **deux tarifs** :

- **4,90 € / mois** (engagement souple)
- **49 € / an** (mis en avant : deux mois offerts, effet d'ancrage)

Ta première tâche back-office : créer ce catalogue dans Stripe, en **mode test**, pour que l'équipe front puisse ensuite brancher un Checkout dessus (module suivant).

Question naïve — et piège classique — : « Je crée *un* objet Premium à 4,90 € et *un* objet Premium à 49 €, non ? »

Non. Dans Stripe, tu crées **un seul Product** (« TribuZen Premium ») et **deux Prices** rattachés à ce Product. Le Product décrit *ce que tu vends* ; les Prices décrivent *combien et à quelle fréquence*. Comprendre cette séparation est le cœur de ce module — tout le reste du cours (Checkout, abonnements, portail, gates) s'appuie dessus.

Voici ce qu'on va produire, en code, à la fin :

```ts
// Un Product…
const premium = await stripe.products.create({ name: 'TribuZen Premium' })

// …et deux Prices rattachés
const monthly = await stripe.prices.create({
  product: premium.id,
  currency: 'eur',
  unit_amount: 490,                    // 4,90 € en cents
  recurring: { interval: 'month' },
})
const yearly = await stripe.prices.create({
  product: premium.id,
  currency: 'eur',
  unit_amount: 4900,                   // 49 € en cents
  recurring: { interval: 'year' },
})
```

---

## 2. Théorie complète, concise

### 2.1 Product vs Price — le quoi et le combien

Stripe sépare volontairement deux notions que l'intuition confond :

- **Product** = *ce que tu vends*. Un concept stable : « TribuZen Premium », « Livre Famille ». Il porte le `name`, la `description`, les images, les `metadata`. Il ne contient **aucun montant**.
- **Price** = *combien, dans quelle devise, à quelle fréquence*. Un `unit_amount`, une `currency`, et — pour un abonnement — un objet `recurring`. Un Price est **toujours rattaché à un Product** (via `product`).

Un Product peut avoir **plusieurs Prices** : mensuel/annuel, EUR/USD, tarif early-bird/tarif normal. C'est exactement le cas TribuZen (un Product Premium, deux Prices).

> **Pourquoi cette séparation ?** Parce que le *tarif* change plus souvent que le *produit*. Tu ne veux pas recréer « TribuZen Premium » (et perdre son historique) chaque fois que tu ajustes un prix. Tu archives l'ancien Price et tu en crées un nouveau, le Product reste le même.

### 2.2 Les 3 modèles de facturation

Le champ `recurring` (présent ou absent) et `usage_type` déterminent le modèle :

| Modèle | `recurring` | Exemple TribuZen | Le Price… |
|--------|-------------|------------------|-----------|
| **One-time** (paiement unique) | absent | « Livre Famille » à 25 € une fois | pas d'objet `recurring` |
| **Recurring** (abonnement) | présent, `usage_type: licensed` (défaut) | Premium 4,90 €/mois | `recurring: { interval: 'month' }` |
| **Usage-based** (à l'usage) | présent, `usage_type: metered` | API B2B facturée par appel | `recurring: { usage_type: 'metered' }` |

Pour le MVP TribuZen, on utilise **recurring licensed** (l'abonnement famille). L'usage-based (metered) est plus complexe (enregistrement des quantités consommées) et hors périmètre du MVP.

### 2.3 L'objet `recurring` en détail

Pour un abonnement, `recurring` précise le rythme de facturation :

```ts
recurring: {
  interval: 'month',      // 'day' | 'week' | 'month' | 'year'
  interval_count: 1,      // optionnel, défaut 1 (ex: interval_count: 3 + interval: 'month' = trimestriel)
  usage_type: 'licensed', // optionnel, défaut 'licensed' (quantité fixe) — 'metered' = à l'usage
}
```

Les seules valeurs valides de `interval` sont `day`, `week`, `month`, `year`. Un abonnement « annuel » c'est `interval: 'year'`, **pas** `interval: 'month', interval_count: 12` (les deux facturent au même rythme, mais `year` est l'expression idiomatique et lisible côté client).

### 2.4 `unit_amount` : toujours en cents

`unit_amount` est un **entier dans la plus petite unité monétaire**. Pour l'euro, ce sont des **centimes** :

- 4,90 € → `unit_amount: 490`
- 49 € → `unit_amount: 4900`
- 25 € → `unit_amount: 2500`

La `currency` est un code ISO à 3 lettres **en minuscules** : `'eur'`, `'usd'`. Écrire `unit_amount: 4.90` ou `currency: 'EUR'` est une source de bug fréquente (voir §4).

### 2.5 Les entités du cycle de facturation

Une fois le catalogue en place, quatre entités structurent la vie d'un abonnement :

- **Customer** — un client Stripe. En pratique : **un utilisateur (ou une famille) TribuZen = un Customer**. On stocke son `id` (`cus_…`) côté BDD pour le relier à notre table users/familles.
- **Subscription** — la relation entre un Customer et un ou plusieurs Prices récurrents. Elle a un `status` (`trialing`, `active`, `past_due`, `canceled`, `unpaid`…). C'est elle qui décide si la famille a accès au premium.
- **Invoice** — chaque échéance de facturation génère une Invoice (facture). Stripe la calcule, la prélève et peut l'envoyer par email automatiquement.
- **Product / Price** — le catalogue (ce module). Une Subscription pointe vers un Price ; un Price pointe vers un Product.

Chaîne mentale : `Product → Price → Subscription (Customer) → Invoice`. Ce module pose les deux premiers maillons ; les suivants sont couverts dans les modules 02 (Checkout) et 04 (subscriptions).

### 2.6 Créer le catalogue via le SDK Node

Le SDK `stripe` est initialisé avec une **clé secrète** (mode test ici) et, en TypeScript, une version d'API épinglée :

```ts
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2026-06-24.dahlia', // épingler la version évite les surprises de comportement
})
```

Les méthodes utiles de ce module :

- `stripe.products.create({ name, description?, metadata? })` → crée un Product.
- `stripe.prices.create({ product, currency, unit_amount, recurring? })` → crée un Price rattaché.
- Raccourci : `stripe.products.create({ ..., default_price_data: {...} })` crée le Product *et* son Price par défaut en un appel.

> Alternative sans code : le **dashboard Stripe** (Products → Add product) crée exactement les mêmes objets. Le dashboard est pratique pour un catalogue stable ; le SDK est indispensable pour scripter, tester et reproduire la config entre environnements (test/live).

### 2.7 Immutabilité et bonnes pratiques

- Un **Price est quasi immuable** : on ne modifie pas son `unit_amount`. Pour changer un tarif, on **archive** l'ancien Price (`active: false`) et on en crée un nouveau. Les abonnements existants continuent sur l'ancien Price.
- **Ne supprime jamais** un Price/Product utilisé : archive-le. La suppression casse l'historique de facturation.
- Stocke les **Price IDs en variables d'environnement** (`price_…`), jamais en dur dans le code — ils diffèrent entre test et live.

---

## 3. Worked examples

### Exemple 1 — Créer le catalogue TribuZen Premium (script d'amorçage)

Objectif : un script one-shot `seed-catalog.ts` qui crée le Product Premium et ses deux Prices en mode test, puis affiche les IDs à copier dans `.env`.

```ts
// scripts/seed-catalog.ts
import Stripe from 'stripe'

// La clé secrète de TEST vit dans .env (jamais commitée).
// Placeholder cassé volontairement — remplace localement par ta vraie clé de test.
//   STRIPE_SECRET_KEY=sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2026-06-24.dahlia',
})

async function seedCatalog(): Promise<void> {
  // 1. Le Product : ce qu'on vend. Aucun montant ici.
  const premium = await stripe.products.create({
    name: 'TribuZen Premium',
    description: 'Abonnement famille : réduction de la charge mentale parentale.',
    metadata: { platform: 'tribuzen', tier: 'premium' }, // metadata libre, utile pour retrouver l'objet
  })

  // 2. Price mensuel : 4,90 € = 490 cents, récurrent chaque mois.
  const monthly = await stripe.prices.create({
    product: premium.id,        // rattachement au Product
    currency: 'eur',            // minuscules
    unit_amount: 490,           // cents, entier
    recurring: { interval: 'month' }, // usage_type 'licensed' par défaut
  })

  // 3. Price annuel : 49 € = 4900 cents, récurrent chaque année.
  const yearly = await stripe.prices.create({
    product: premium.id,
    currency: 'eur',
    unit_amount: 4900,
    recurring: { interval: 'year' },
  })

  // 4. On affiche les IDs à reporter dans .env (ils diffèrent en test/live).
  console.log('Product :', premium.id)
  console.log('STRIPE_PRICE_PREMIUM_MONTHLY=', monthly.id)
  console.log('STRIPE_PRICE_PREMIUM_YEARLY=', yearly.id)
}

seedCatalog().catch((err) => {
  console.error('Échec du seed :', err)
  process.exitCode = 1
})
```

Exécution (mode test), sortie attendue :

```
Product : prod_XXXXXXXXXXXXXX
STRIPE_PRICE_PREMIUM_MONTHLY= price_XXXXXXXXXXXXXX
STRIPE_PRICE_PREMIUM_YEARLY= price_YYYYYYYYYYYYYY
```

On copie ensuite ces `price_…` dans `.env` :

```bash
# .env — mode test ; JAMAIS commité (voir .gitignore)
STRIPE_SECRET_KEY=sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>
STRIPE_PRICE_PREMIUM_MONTHLY=price_XXXXXXXXXXXXXX
STRIPE_PRICE_PREMIUM_YEARLY=price_YYYYYYYYYYYYYY
```

### Exemple 2 — Product + Price par défaut en un seul appel

Pour un produit simple (ex. le « Livre Famille » one-time à 25 €), `default_price_data` évite le second appel :

```ts
// One-time : pas d'objet recurring → paiement unique.
const livre = await stripe.products.create({
  name: 'Livre Famille',
  default_price_data: {
    currency: 'eur',
    unit_amount: 2500, // 25,00 €
    // pas de recurring → Stripe crée un Price one-time
  },
})

// Le Price par défaut est accessible via product.default_price
console.log('Livre Price ID :', livre.default_price)
```

Ici, l'absence de `recurring` dans `default_price_data` fait de ce Price un **one-time** : c'est le modèle de facturation « paiement unique ».

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Créer un Product par tarif

```ts
// ❌ Deux Products « Premium » pour deux tarifs : historique éclaté, dashboard confus
const premiumMonthly = await stripe.products.create({ name: 'TribuZen Premium Mensuel' })
const premiumYearly  = await stripe.products.create({ name: 'TribuZen Premium Annuel' })

// ✅ Un Product, deux Prices
const premium = await stripe.products.create({ name: 'TribuZen Premium' })
await stripe.prices.create({ product: premium.id, currency: 'eur', unit_amount: 490,  recurring: { interval: 'month' } })
await stripe.prices.create({ product: premium.id, currency: 'eur', unit_amount: 4900, recurring: { interval: 'year' } })
```

Le Product est le concept ; les tarifs sont des Prices. Un tarif ≠ un produit.

### PIÈGE #2 — `unit_amount` en euros au lieu de cents

```ts
// ❌ 4,90 € facturé comme… 4,90 cents (soit 0,05 €), ou rejeté si non entier
unit_amount: 4.90

// ✅ Toujours en cents, entier
unit_amount: 490   // = 4,90 €
```

`unit_amount` est un entier dans la plus petite unité (centimes pour l'euro). C'est **le** bug de débutant Stripe.

### PIÈGE #3 — `currency` en majuscules

```ts
currency: 'EUR'   // ❌ rejeté — l'API attend le code ISO en minuscules
currency: 'eur'   // ✅
```

### PIÈGE #4 — Modifier le montant d'un Price existant

Un Price n'a pas de « champ prix modifiable ». On ne peut pas passer 4,90 € → 5,90 € en éditant le Price. Il faut **archiver** l'ancien et **créer** un nouveau Price :

```ts
// Archiver l'ancien (les abonnements en cours ne sont pas touchés)
await stripe.prices.update('price_ancien', { active: false })
// Créer le nouveau tarif
const nouveau = await stripe.prices.create({
  product: 'prod_premium',
  currency: 'eur',
  unit_amount: 590,
  recurring: { interval: 'month' },
})
```

### PIÈGE #5 — Confondre Customer et User applicatif

Le **Customer Stripe** (`cus_…`) n'est pas ton utilisateur en BDD : c'est une entité *Stripe* qui porte les moyens de paiement et l'historique de facturation. Tu dois **stocker le lien** (`stripeCustomerId`) dans ta propre table, sinon tu ne sauras jamais quel Customer correspond à quelle famille TribuZen.

### PIÈGE #6 — Price IDs en dur dans le code

Les `price_…` **diffèrent entre le mode test et le mode live**. Codés en dur, ils casseront en production. Ils vont dans les variables d'environnement, comme la clé secrète.

---

## 5. Ancrage TribuZen

Ce module crée la **fondation du back-office facturation TribuZen** : le catalogue « TribuZen Premium ».

Dans le vrai produit, le catalogue est créé **une fois** par environnement (test, puis live) via un script d'amorçage versionné, et les IDs résultants vivent dans la config :

```
tribuzen/
  apps/
    api/
      scripts/
        seed-catalog.ts         ← Exemple 1 : crée Product Premium + Prices mensuel/annuel
      src/
        billing/
          billing.config.ts      ← lit STRIPE_PRICE_PREMIUM_MONTHLY / _YEARLY depuis l'env
      .env                       ← clés + price IDs (mode test) — jamais commité
      .env.example               ← mêmes clés, valeurs placeholder
```

Le mapping métier TribuZen :

| Concept produit | Objet Stripe |
|-----------------|--------------|
| Offre « Premium » | **Product** `TribuZen Premium` |
| Tarif mensuel 4,90 € | **Price** recurring `interval: 'month'` |
| Tarif annuel 49 € | **Price** recurring `interval: 'year'` |
| Une famille abonnée | **Customer** (`stripeCustomerId` en BDD) |
| Son abonnement actif | **Subscription** (`status: 'active'`) |
| Sa facture mensuelle | **Invoice** |

Ce module s'arrête au catalogue (Product + Price). La création du Customer, de la Subscription et la lecture des Invoices arrivent dans les modules 02, 04 et 08.

---

## 6. Points clés

1. **Product = ce que tu vends** (nom, description) ; **Price = combien/quand** (montant, devise, `recurring`). Un Product porte plusieurs Prices.
2. **3 modèles** : one-time (pas de `recurring`), recurring licensed (abonnement à quantité fixe), usage-based metered (à l'usage). TribuZen MVP = recurring licensed.
3. `recurring.interval` ∈ `day | week | month | year` ; un annuel = `interval: 'year'`.
4. `unit_amount` est un **entier en cents** ; `currency` est un code ISO **en minuscules**.
5. Entités du cycle : **Customer → Subscription → Invoice**, adossées au couple **Product → Price**.
6. Créer via `stripe.products.create` puis `stripe.prices.create` (ou `default_price_data` en un appel).
7. Un Price est **quasi immuable** : pour changer un tarif, on **archive** et on **recrée** ; on ne supprime jamais.
8. Les **Price IDs** (et la clé secrète) vivent dans l'**environnement**, jamais en dur — ils diffèrent test/live.

---

## 7. Seeds Anki

```
Dans Stripe, quelle est la différence entre un Product et un Price ?|Le Product décrit ce que tu vends (nom, description, sans montant). Le Price décrit combien/dans quelle devise/à quelle fréquence, et est rattaché à un Product. Un Product peut avoir plusieurs Prices.
Comment modéliser un abonnement mensuel ET annuel du même produit dans Stripe ?|Un seul Product, deux Prices récurrents rattachés : l'un recurring interval 'month', l'autre interval 'year'. Jamais deux Products.
Quels sont les 3 modèles de facturation Stripe et comment les distinguer ?|One-time (pas d'objet recurring), recurring licensed (recurring présent, usage_type licensed = quantité fixe), usage-based metered (recurring présent, usage_type metered = facturé à l'usage).
Quelles sont les valeurs valides de recurring.interval ?|day, week, month, year. Un abonnement annuel s'exprime interval 'year', pas interval 'month' interval_count 12.
Dans quelle unité s'exprime unit_amount et sous quelle forme la currency ?|unit_amount est un entier dans la plus petite unité monétaire (cents pour l'euro : 4,90 € = 490). currency est un code ISO à 3 lettres en minuscules ('eur').
Comment change-t-on le montant d'un Price existant ?|On ne le modifie pas : un Price est quasi immuable. On archive l'ancien (active: false) et on crée un nouveau Price. Les abonnements en cours restent sur l'ancien.
Quel est le rôle des entités Customer, Subscription et Invoice ?|Customer = le client Stripe (une famille TribuZen). Subscription = la relation Customer↔Price récurrent, avec un status (active, past_due…). Invoice = une facture générée à chaque échéance.
Pourquoi ne jamais coder les Price IDs en dur ?|Les IDs price_… diffèrent entre mode test et mode live. En dur, ils cassent en production. Ils vont dans les variables d'environnement, comme la clé secrète.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-01-stripe-products-et-prices/README.md`. Créer le catalogue TribuZen Premium (Product + Prices mensuel/annuel) via le SDK Node en mode test — script réel, corrigé commenté, zéro clé commitée.
