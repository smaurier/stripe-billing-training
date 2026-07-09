# Lab 01 — Stripe Products & Prices : le catalogue TribuZen Premium

> **Outcome :** à la fin, tu sais créer un Product et ses deux Prices (mensuel + annuel) dans Stripe **en mode test**, via un vrai script Node avec le SDK `stripe`, et récupérer les `price_…` à mettre en config.
> **Vrai outil :** SDK officiel `stripe` (Node) + un compte Stripe en **mode test** + le dashboard Stripe pour vérifier visuellement. JAMAIS un harnais simulé.
> **Feedback :** le coach valide en session (Product + 2 Prices visibles dans le dashboard Stripe test, IDs affichés par le script). Pas de test-runner auto-correcteur.

> ⚠️ **Sécurité clés Stripe.** Ta clé secrète de test vit **uniquement** dans `.env`, jamais dans le code ni dans un commit. Dans ce README et tout fichier versionné, on n'écrit que le **placeholder cassé** `sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>`. GitHub bloque le push si une vraie clé fuit. Crée un `.gitignore` avec `.env` et `node_modules/` **avant** tout commit.

---

## Énoncé

Tu es back-office TribuZen. On te demande de matérialiser l'offre **TribuZen Premium** dans Stripe (mode test) :

- **1 Product** : `TribuZen Premium`, avec une description et des `metadata`.
- **1 Price mensuel** : 4,90 € récurrent chaque mois.
- **1 Price annuel** : 49 € récurrent chaque année.

Le livrable : un script `seed-catalog.ts` qui crée ces objets **et affiche les IDs** (`prod_…`, `price_…`) à reporter dans `.env`. Tu vérifies ensuite dans le **dashboard Stripe** (mode test) que le Product apparaît bien avec ses deux tarifs.

**Pas de gap-fill** — tu écris le script à partir du starter minimal ci-dessous.

### Prérequis de setup (à faire une fois)

1. Crée (ou réutilise) un compte Stripe et **reste en mode test** (toggle en haut à droite du dashboard).
2. Récupère ta **clé secrète de test** (`sk_test_…`) dans Developers → API keys.
3. Initialise un projet Node minimal :

```bash
npm init -y
npm install stripe
npm install -D typescript tsx @types/node
```

4. Crée le `.gitignore` **d'abord** :

```gitignore
node_modules/
.env
```

5. Crée `.env` (jamais commité) et `.env.example` (commité, valeurs placeholder) :

```bash
# .env  — TA vraie clé de test ici, en local uniquement
STRIPE_SECRET_KEY=sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>
```

```bash
# .env.example  — commité, ne contient QUE le placeholder
STRIPE_SECRET_KEY=sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>
```

### Starter minimal

Crée `seed-catalog.ts` :

```ts
// seed-catalog.ts — starter
import 'dotenv/config' // ou: node --env-file=.env (Node 20+)
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2026-06-24.dahlia', // épingle la version d'API
})

async function seedCatalog(): Promise<void> {
  // À toi :
  // 1. créer le Product "TribuZen Premium"
  // 2. créer le Price mensuel 4,90 € (recurring month)
  // 3. créer le Price annuel 49 € (recurring year)
  // 4. console.log des IDs à copier dans .env
}

seedCatalog().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
```

Lance-le avec `npx tsx seed-catalog.ts` (installe aussi `dotenv` si tu utilises `import 'dotenv/config'`, ou lance `node --env-file=.env` avec un build).

---

## Étapes (en friction)

1. **Vérifie que tu es en mode test.** Ta clé commence par `sk_test_`. Une clé `sk_live_` créerait de vrais objets facturables — ne la mets jamais ici.
2. **Crée le Product** avec `stripe.products.create({ name, description, metadata })`. Note : aucun montant à ce stade.
3. **Crée le Price mensuel** : `stripe.prices.create({ product: <id>, currency: 'eur', unit_amount: 490, recurring: { interval: 'month' } })`. Réfléchis à pourquoi `490` et pas `4.90`.
4. **Crée le Price annuel** : même chose, `unit_amount: 4900`, `recurring: { interval: 'year' }`.
5. **Affiche les IDs** (`prod_…`, `price_…`) avec des `console.log` clairs, prêts à copier dans `.env`.
6. **Vérifie dans le dashboard** (mode test) → Products : le Product `TribuZen Premium` doit lister **deux** tarifs (mensuel + annuel).
7. **Cas limite — idempotence.** Relance le script : tu obtiens un **second** Product et deux nouveaux Prices (Stripe ne déduplique pas par nom). Observe-le, puis réfléchis à la variante J+30.
8. **Reporte** les `price_…` dans `.env` sous `STRIPE_PRICE_PREMIUM_MONTHLY` / `STRIPE_PRICE_PREMIUM_YEARLY`.

---

## Corrigé complet commenté

```ts
// seed-catalog.ts — corrigé
import 'dotenv/config'
import Stripe from 'stripe'

// La clé secrète de TEST vit dans .env (jamais commitée).
// Le README ne montre que le placeholder cassé sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2026-06-24.dahlia', // épingler évite les changements de comportement silencieux
})

async function seedCatalog(): Promise<void> {
  // ── 1. Le Product : ce qu'on vend. Pas de montant ici. ──
  const premium = await stripe.products.create({
    name: 'TribuZen Premium',
    description: 'Abonnement famille : réduction de la charge mentale parentale.',
    // metadata libre — utile pour filtrer/retrouver l'objet plus tard
    metadata: { platform: 'tribuzen', tier: 'premium' },
  })

  // ── 2. Price mensuel : 4,90 € = 490 cents, récurrent chaque mois. ──
  const monthly = await stripe.prices.create({
    product: premium.id,               // rattachement obligatoire au Product
    currency: 'eur',                   // code ISO en MINUSCULES
    unit_amount: 490,                  // ENTIER en cents : 490 = 4,90 €
    recurring: { interval: 'month' },  // usage_type 'licensed' par défaut (quantité fixe)
  })

  // ── 3. Price annuel : 49 € = 4900 cents, récurrent chaque année. ──
  const yearly = await stripe.prices.create({
    product: premium.id,
    currency: 'eur',
    unit_amount: 4900,                 // 49,00 €
    recurring: { interval: 'year' },   // 'year', pas 'month' × 12
  })

  // ── 4. Les IDs à reporter dans .env (ils diffèrent test/live). ──
  console.log('Product              :', premium.id)
  console.log('STRIPE_PRICE_PREMIUM_MONTHLY=' + monthly.id)
  console.log('STRIPE_PRICE_PREMIUM_YEARLY=' + yearly.id)
}

seedCatalog().catch((err) => {
  console.error('Échec du seed :', err)
  process.exitCode = 1
})
```

Sortie attendue (les IDs varient) :

```
Product              : prod_XXXXXXXXXXXXXX
STRIPE_PRICE_PREMIUM_MONTHLY=price_XXXXXXXXXXXXXX
STRIPE_PRICE_PREMIUM_YEARLY=price_YYYYYYYYYYYYYY
```

**Pourquoi ce corrigé est correct :**
- **Un** Product, **deux** Prices — le tarif n'est pas un produit. Le dashboard affiche Premium avec deux lignes de prix.
- `unit_amount` en cents entiers (`490`, `4900`), `currency` en minuscules — les deux pièges de débutant Stripe évités.
- L'annuel est `recurring: { interval: 'year' }`, expression idiomatique d'un rythme annuel.
- La clé n'apparaît nulle part dans le code : elle est lue depuis `process.env`, alimentée par `.env` non commité.

### Grille de validation (le coach coche)

- [ ] Le mode **test** est actif (clé `sk_test_…`, objets visibles dans le dashboard test uniquement).
- [ ] **Un seul** Product `TribuZen Premium` est créé (pas un par tarif).
- [ ] **Deux** Prices rattachés : mensuel `490`/`month`, annuel `4900`/`year`.
- [ ] `currency: 'eur'` (minuscules) et `unit_amount` en cents entiers.
- [ ] Le script **affiche** les IDs `prod_…` et `price_…`.
- [ ] `.gitignore` contient `.env` ; **aucune vraie clé** n'est présente dans un fichier versionné.
- [ ] Les `price_…` sont reportés dans `.env`, pas codés en dur.

### Coaching — questions à poser en session

1. « Pourquoi un seul Product et pas un par tarif ? » (attendu : Product = concept, Price = tarif ; historique/dashboard propres).
2. « Que se passe-t-il si tu écris `unit_amount: 4.90` ? » (attendu : facturé 4,90 cents ≈ 0,05 € ou rejeté — toujours en cents entiers).
3. « Tu relances le script : combien d'objets as-tu maintenant ? » (attendu : Stripe ne déduplique pas → doublons ; d'où le besoin d'idempotence, cf. J+30).
4. « Comment passerais-tu Premium de 4,90 € à 5,90 € plus tard ? » (attendu : archiver l'ancien Price `active: false` + créer un nouveau Price, jamais éditer le montant).
5. « Où vivent la clé secrète et les Price IDs, et pourquoi pas dans le code ? » (attendu : dans `.env` / l'environnement, car ils diffèrent test/live et ne doivent pas fuiter).

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir le corrigé ni le module :**

1. Rends le script **idempotent** : avant de créer, cherche un Product existant nommé `TribuZen Premium` (via `stripe.products.search` avec une requête sur `metadata` ou `name`, ou en listant). S'il existe, réutilise-le au lieu d'en créer un doublon. Idem pour éviter de recréer des Prices identiques.
2. Ajoute un **3e tarif** : une variante « famille nombreuse » à 7,90 €/mois — nouveau Product `TribuZen Famille` OU nouveau Price sur un nouveau Product (justifie ton choix : est-ce le même produit ?).
3. **Contrainte de temps :** 25 minutes, sans copier-coller le corrigé.

**Critère de réussite :** relancer le script deux fois ne crée **aucun** doublon, et le dashboard reste propre (un Product Premium, ses tarifs uniques).

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ce script d'amorçage vit ici :

```
tribuzen/
  apps/
    api/
      scripts/
        seed-catalog.ts          ← ce lab
      src/
        billing/
          billing.config.ts       ← lit STRIPE_PRICE_PREMIUM_MONTHLY / _YEARLY depuis l'env
      .env                        ← clé test + price IDs — jamais commité
      .env.example                ← placeholders uniquement
      .gitignore                  ← .env, node_modules/
```

**Différences par rapport au lab :**

- Le script est **idempotent** dès le départ (recherche avant création) — sinon chaque déploiement dupliquerait le catalogue.
- Les IDs ne sont pas juste `console.log` : ils sont lus depuis l'env par `billing.config.ts`, qui expose un objet typé `PREMIUM_PRICES` au reste de l'API.
- Le seed est lancé **une fois par environnement** (test, puis live avec la clé live), pas à chaque démarrage.

**Commit cible :**

```
feat(billing): seed catalog TribuZen Premium (Product + prices mensuel/annuel, mode test)
```
