---
titre: Testing et mise en production — le flux TribuZen Premium de bout en bout
cours: 22-stripe-billing
notions: ["cartes de test (4242, 3DS 4000 0025 0000 3155, decline)", "PaymentMethods de test (pm_card_visa)", "Stripe CLI (stripe login/listen/trigger)", "récupérer le whsec de stripe listen", "tester les webhooks en local", "test clocks (test_helpers/test_clocks)", "avancer le temps (advance)", "simuler un cycle d'abonnement (trial -> renouvellement -> échec)", "mode test vs mode live", "objets non partagés test/live", "checklist go-live", "bascule des clés", "webhooks live séparés", "rotation des secrets", "monitoring et logs", "capstone TribuZen Premium end-to-end"]
outcomes:
  - sait tester un flux de paiement avec les cartes de test (succès, 3DS, refus) et les PaymentMethods de test
  - sait utiliser la Stripe CLI (login, listen, trigger) pour recevoir et déclencher des webhooks en local
  - sait simuler le temps avec un test clock pour observer trial, renouvellement et échec de paiement sur un abonnement
  - sait distinguer mode test et mode live et pourquoi les objets ne sont pas partagés
  - sait dérouler une checklist go-live (bascule des clés, webhooks live, rotation des secrets, monitoring)
  - sait assembler le flux TribuZen Premium complet (produits -> checkout -> webhook -> abonnement -> portail -> gates -> facturation) et le prouver
prerequis: ["00-introduction-au-billing-saas", "01-stripe-products-et-prices", "02-stripe-checkout-et-payment-links", "03-webhooks-et-idempotence", "04-subscriptions-et-cycle-de-vie", "05-customer-portal-et-self-service", "06-freemium-et-feature-gating", "07-paiements-echoues-et-dunning", "08-facturation-taxes-et-legalite"]
next: fin-parcours-22-stripe-billing
libs: [{ name: stripe, version: "latest (API 2026-06-24)" }]
tribuzen: mise en production de TribuZen Premium — tester le billing complet (cartes de test, Stripe CLI, test clocks) puis basculer en live sans se faire piéger (clés, webhooks prod, rotation des secrets, monitoring)
last-reviewed: 2026-07
---

# Testing et mise en production — le flux TribuZen Premium de bout en bout

> **Outcomes — tu sauras FAIRE :** tester un flux de paiement avec les **cartes de test** (succès, 3DS, refus), piloter la **Stripe CLI** (`login`/`listen`/`trigger`) pour recevoir et déclencher des webhooks en local, **simuler le temps** avec un **test clock** pour observer trial → renouvellement → échec sur un abonnement, distinguer **test** et **live** mode, dérouler une **checklist go-live** (bascule des clés, webhooks live, rotation des secrets, monitoring), et **assembler + prouver** le flux **TribuZen Premium** complet.
> **Difficulté :** :star::star::star::star::star:
>
> **Portée :** ce module est le **capstone** du cours. Il **n'introduit presque aucune notion neuve** — il **assemble** les modules 00 à 08 en un seul flux payant réel, puis ajoute la seule chose qui manquait : **prouver** que ça marche (tests) et **le mettre en live sans se faire piéger** (go-live). Si un maillon ci-dessous te semble flou (`constructEvent`, `proration_behavior`, gate d'entitlement, dunning), c'est le signal de **rouvrir le module source** avant de coder, pas de deviner.
>
> **⚠️ Module sécurité (clés en prod).** La mise en live manipule des **clés qui encaissent de l'argent réel**. Une `sk_live_...` fuitée = fraude immédiate. Dans tout fichier suivi par git, on n'écrit **que** des placeholders cassés type <code v-pre>sk_test_&lt;CLE-EXEMPLE-NE-JAMAIS-COMMITTER&gt;</code>. Les vraies clés vivent dans le secret manager de la prod, **jamais** dans le repo.

## 1. Cas concret d'abord

Depuis le module 00, tu as construit TribuZen Premium brique par brique : un Product + des Prices (01), une Checkout Session (02), un webhook signé et idempotent (03), le cycle de vie des abonnements (04), le Customer Portal (05), les gates freemium (06), le dunning des paiements échoués (07), les factures et la TVA (08). Chaque brique, tu l'as vue **isolément**, en **mode test**, et elle marchait.

Aujourd'hui, le board te dit :

> « On ouvre les abonnements payants **vendredi**. Je veux la preuve que le flux tient : un parent s'abonne, l'essai se termine, le renouvellement passe, et si sa carte est refusée on le relance — **sans attendre 90 jours réels** pour le vérifier. Et je veux qu'on bascule en live **sans qu'une clé traîne sur GitHub**. »

Trois problèmes très concrets t'attendent, et aucun n'a de solution « au feeling » :

1. **Tu ne peux pas payer avec une vraie carte pour tester**, ni attendre que 14 jours d'essai s'écoulent, ni patienter un mois pour voir un renouvellement. Il te faut de **fausses cartes déterministes** et une **machine à voyager dans le temps** (les *test clocks*).
2. **Ton webhook tourne sur `localhost`** — Stripe ne peut pas l'atteindre depuis Internet. Il te faut la **Stripe CLI** pour router les vrais events vers ta machine et pour en **déclencher** à la demande.
3. **Le jour du go-live**, tu vas échanger des clés `test` contre des clés `live`, recréer les webhooks et les produits en live, et t'assurer qu'aucune clé n'a fuité pendant le dev. Une **checklist** — pas ta mémoire — est la seule défense.

Ce module te fait **tester le flux complet** puis **le mettre en production sans te faire piéger**.

---

## 2. Théorie complète, concise

Deux moitiés : **tester** (2.1 → 2.5) puis **mettre en live** (2.6 → 2.9). Le capstone (2.10) relie tout.

### 2.1 Test mode vs live mode — deux mondes étanches

Stripe expose deux environnements **identiques dans le comportement**, **séparés dans les données** :

- Le **mode test** utilise des clés `sk_test_...` / `pk_test_...`. Aucun argent réel ne bouge. Les cartes sont fausses.
- Le **mode live** utilise des clés `sk_live_...` / `pk_live_...`. De l'argent réel est débité.

Règle qui surprend tout le monde : **les objets ne sont PAS partagés entre test et live**. Un Product, un Price, un webhook endpoint, un customer créés en test **n'existent pas** en live. Au go-live, il faut **tout recréer en live** — idéalement avec les **mêmes identifiants logiques** (mêmes `lookup_key` de Price, même structure) pour que ton code fonctionne sans changement.

> **Règle TribuZen :** un `price_...` de test ne marchera jamais en live. Les Price IDs viennent **toujours** de la config d'environnement (`STRIPE_PRICE_PREMIUM_MONTHLY`), jamais en dur — sinon le code casse le jour du go-live.

### 2.2 Les cartes de test — des numéros déterministes

En mode test, tu ne peux pas (et ne dois pas) utiliser une vraie carte. Stripe fournit des **numéros de test** au comportement **garanti** (vérifiés sur `docs.stripe.com/testing`) :

| Carte | Numéro | Comportement |
|---|---|---|
| Visa — succès | `4242 4242 4242 4242` | Paiement réussi, sans authentification |
| 3D Secure / SCA requis | `4000 0025 0000 3155` | Demande une authentification (off-session, sauf si carte enregistrée) |
| 3DS **toujours** requis | `4000 0027 6000 3184` | Authentification exigée à **chaque** transaction |
| Refus générique | `4000 0000 0000 0002` | `card_declined` / `generic_decline` |
| Fonds insuffisants | `4000 0000 0000 9995` | `card_declined` / `insufficient_funds` |

Date d'expiration : **n'importe quelle date future**. CVC : **n'importe quels 3 chiffres**.

Pour les tests **côté serveur** (sans passer par un formulaire), Stripe fournit des **PaymentMethods de test** pré-construits, notamment **`pm_card_visa`** (succès) — tu les attaches directement à un customer sans jamais manipuler de numéro. C'est ce qu'on a utilisé au lab 04.

### 2.3 La Stripe CLI — router et déclencher les webhooks en local

Ton endpoint webhook (module 03) tourne sur `localhost:3000`. Stripe, sur Internet, ne peut pas l'appeler. La **Stripe CLI** résout ça (commandes vérifiées sur `docs.stripe.com`) :

```bash
# 1. S'authentifier une fois (ouvre le navigateur, lie ton compte test)
stripe login

# 2. Écouter les events et les RE-ROUTER vers ton endpoint local
stripe listen --forward-to localhost:3000/webhooks/stripe
```

Au lancement, `stripe listen` **imprime le secret de signature** à utiliser en local :

```
Ready! Your webhook signing secret is 'whsec_...' (^C to quit)
```

Ce `whsec_...` (de test, local) est celui que tu mets dans `.env` pour que `constructEvent` (module 03) valide les signatures. **Il est différent** du secret de l'endpoint que tu créeras en live.

Pour **provoquer** un event sans jouer tout le scénario à la main :

```bash
# Déclenche un event de test et l'envoie à ton listener
stripe trigger checkout.session.completed
stripe trigger customer.subscription.trial_will_end
stripe trigger invoice.payment_failed
```

> **Ordre impératif :** lance `stripe listen` **AVANT** de déclencher un `trigger` ou d'exécuter ton script — sinon l'event part dans le vide, ton listener n'écoutait pas encore.

### 2.4 Les test clocks — simuler le temps

Un abonnement vit **dans le temps** : essai de 14 jours, renouvellement mensuel, relances de dunning sur plusieurs jours. Tu ne peux pas **attendre** pour tester. Les **test clocks** (`test_helpers/test_clocks`, vérifiés sur `docs.stripe.com`) sont une **horloge simulée** : tu attaches un customer à cette horloge, puis tu **avances le temps**, et Stripe fait vivre l'abonnement (facture, renouvelle, échoue, émet les webhooks) **instantanément**.

Trois opérations :

```
1. CRÉER l'horloge   → POST /v1/test_helpers/test_clocks   { frozen_time }
                        (SDK : stripe.testHelpers.testClocks.create)
2. RATTACHER          → créer le customer avec { test_clock: 'clock_...' }
                        (tout ce qui découle du customer suit l'horloge)
3. AVANCER            → POST /v1/test_helpers/test_clocks/{id}/advance  { frozen_time }
                        (SDK : stripe.testHelpers.testClocks.advance)
```

Contraintes à connaître :
- le temps **n'avance que vers l'avant** (jamais en arrière) ;
- **au plus 2 périodes de facturation** (ou 2 ans sans abonnement) par `advance` — pour un saut plus long, on avance **par paliers**.

Avec un test clock, on **compresse** le scénario du board : créer l'abonnement en `trialing` → avancer à J+14 (fin d'essai → première facture → `invoice.paid` + `active`) → avancer d'un mois (renouvellement) → sur une carte qui échoue, observer `invoice.payment_failed` et le dunning (module 07). Tout ça en **secondes**.

### 2.5 Tester les webhooks — la boucle de vérité

L'état payant se décide sur les **webhooks** (module 03), donc *tester le flux = tester les webhooks*. La boucle locale :

1. `stripe listen --forward-to localhost:3000/webhooks/stripe` (récupère le `whsec_...`) ;
2. mets ce `whsec_...` dans `.env`, démarre l'API NestJS ;
3. joue le scénario (Checkout avec `4242...`, ou `stripe trigger`, ou un test clock qu'on avance) ;
4. **vérifie** dans les logs : signature validée, event routé, `user.tier` mis à jour, **idempotence** (rejoue le même event → aucun double effet).

Ce qui **prouve** que le webhook tient : renvoyer un `stripe trigger` deux fois (ou avancer le clock puis rejouer) **ne double pas** l'effet — parce que le handler est idempotent sur `event.id` (module 03).

### 2.6 La checklist go-live — bascule test → live

Le go-live n'est **pas** « je change une variable ». C'est une **checklist** (alignée sur `docs.stripe.com`, checklist officielle) :

1. **Bascule des clés** — remplacer `sk_test_...`/`pk_test_...` par `sk_live_...`/`pk_live_...`, **uniquement** via le secret manager de la prod (jamais dans le repo).
2. **Version d'API figée** — épingler une version d'API Stripe explicite (ex. la version courante `2026-06-24`) et la garder constante, pour ne pas subir un changement de schéma en prod.
3. **Webhooks live séparés** — créer un **nouvel** endpoint webhook **en mode live** dans le Dashboard : il a son **propre** `whsec_...` (différent du secret de `stripe listen`). L'endpoint doit tolérer les livraisons **retardées**, **dupliquées**, **dans le désordre** (ce que garantit déjà ton handler idempotent du module 03).
4. **Recréer les objets en live** — Products, Prices, config du Portal, Stripe Tax : **rien** n'est repris du test. Recréer avec les mêmes identifiants logiques.
5. **Gestion d'erreur testée** — cartes refusées, données incomplètes, requêtes dupliquées : messages clairs à l'utilisateur (« carte refusée » ≠ « erreur serveur »).
6. **Monitoring & logs** — surveiller le Dashboard (Logs, Events, échecs de webhook), logger côté serveur les décisions de tier, mettre en place une alerte sur les `invoice.payment_failed` en série.
7. **Rotation des secrets** — voir 2.7.

### 2.7 Rotation et sécurité des clés — non négociable

Stripe le dit explicitement dans sa checklist : **avant** le go-live, **fais tourner (rotate) tes clés API** au cas où elles auraient été exposées pendant le développement (logs, capture d'écran, commit accidentel). Ensuite, **rotation régulière**.

Principes de sécurité des clés en prod :

- **Aucune clé en dur** dans le code, ni dans un fichier commité. Uniquement dans un **secret manager** (variables d'env chiffrées de la plateforme : Render, Railway, AWS Secrets Manager, Doppler…).
- **`.env` dans `.gitignore`**, toujours. Un `sk_live_...` poussé sur un repo, même privé, est considéré **compromis** : Stripe et GitHub le détectent (push protection) — il faut le **révoquer immédiatement**.
- **Rotation = créer la nouvelle clé, déployer, puis révoquer l'ancienne** (dans cet ordre, pour ne pas couper le service).
- La `pk_...` (publishable) est publique par nature (elle va dans le front) ; la `sk_...` (secret) ne quitte **jamais** le serveur ; le `whsec_...` ne quitte **jamais** le serveur non plus.

> **Règle TribuZen :** si un doute existe sur l'exposition d'une clé (« je l'ai peut-être collée dans un ticket »), on **rotate**. C'est gratuit et instantané ; une fraude ne l'est pas.

### 2.8 Monitoring en production

Une fois live, la vérité arrive **par les webhooks et le Dashboard**, pas par supposition :

- **Dashboard → Events / Logs** : chaque requête API et chaque event livré, avec les échecs de livraison webhook (Stripe **retente** jusqu'à 3 jours) ;
- **côté TribuZen** : logger chaque transition de tier (`free → premium`, `active → past_due`) avec l'`event.id`, pour tracer *qui* a changé *quand* et *pourquoi* ;
- **alertes** : une série de `invoice.payment_failed` ou un pic de `constructEvent` en échec (signature invalide) = incident à investiguer.

### 2.9 Ce que le go-live NE change PAS

Point rassurant et important : test et live sont **volontairement identiques** en comportement. Ton code (SDK, `constructEvent`, routage d'events, gates) est **le même**. Seules changent : les **clés**, les **IDs d'objets** (recréés) et le **secret webhook**. Si ton flux marche en test avec un test clock et `stripe listen`, il marchera en live — à condition d'avoir coché la checklist.

### 2.10 La carte de montage du capstone — le flux TribuZen Premium complet

Le capstone **n'ajoute rien** aux modules 00-08 : il les **branche** en une seule chaîne, du clic « S'abonner » à la facture, puis le **prouve**.

| Étape du flux | Mécanisme | Module | Rôle |
|---|---|---|---|
| Catalogue | Product + Prices (mensuel/annuel) | 01 | l'offre Premium |
| Souscription | Checkout Session `mode: subscription` | 02 | page de paiement hébergée |
| Activation | webhook signé + idempotent | 03 | **décide** Premium (jamais le success_url) |
| Cycle de vie | statuts, trial, proration, annulation | 04 | l'abonnement vit dans le temps |
| Self-service | Customer Portal | 05 | le client gère son abo seul |
| Accès | gates / entitlements | 06 | ce que Premium débloque |
| Résilience | dunning, `past_due`, relances | 07 | survivre à une carte qui échoue |
| Facturation | invoices, TVA, légal | 08 | conformité comptable |
| **Preuve** | cartes de test + CLI + test clock | **09** | **prouver** avant le live |
| **Go-live** | clés, webhooks live, rotation, monitoring | **09** | **livrer** sans se faire piéger |

Le capstone (le lab) te fait **assembler** cette chaîne et la **prouver** : un parcours complet joué avec `4242...`, un cycle compressé par un test clock, un event rejoué pour vérifier l'idempotence — puis dérouler la checklist go-live sur papier.

---

## 3. Worked examples

Deux exemples. Le premier **simule un cycle d'abonnement complet dans le temps** (test clock). Le second **assemble et prouve** le flux de bout en bout.

### Exemple 1 — simuler trial → renouvellement → échec avec un test clock

Objectif : sans attendre un seul jour réel, faire vivre un abonnement TribuZen Premium et observer les webhooks arriver. On utilise le vrai SDK en **mode test**.

```js
// simulate-lifecycle.js — vrai SDK Stripe, mode test, avec un test clock
import 'dotenv/config'
import Stripe from 'stripe'

// Clé lue depuis .env (jamais commité). Ici : placeholder cassé.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const MONTHLY = process.env.STRIPE_PRICE_PREMIUM_MONTHLY // price_... de TEST

// Convertit une durée en timestamp Unix (secondes) à partir de "maintenant simulé"
const inDays = (from, days) => from + days * 24 * 60 * 60

async function main() {
  const now = Math.floor(Date.now() / 1000)

  // ── 1. Créer l'horloge simulée, figée à "maintenant" ─────────────────────
  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: now,
    name: 'TribuZen Premium — cycle complet',
  })

  // ── 2. Customer RATTACHÉ à l'horloge + moyen de paiement de test ─────────
  // Tout ce qui découle de ce customer suivra l'horloge.
  const customer = await stripe.customers.create({
    email: 'martin@tribuzen.test',
    test_clock: clock.id, // <- le rattachement à l'horloge simulée
  })
  const pm = await stripe.paymentMethods.attach('pm_card_visa', {
    customer: customer.id, // carte de test qui RÉUSSIT
  })
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: pm.id },
  })

  // ── 3. Abonnement mensuel avec essai de 14 jours ─────────────────────────
  let sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: MONTHLY }],
    trial_period_days: 14,
  })
  console.log('créé  :', sub.status) // 'trialing'

  // ── 4. AVANCER à J+14 : fin d'essai → 1re facture → active ───────────────
  // Stripe facture, émet invoice.paid + customer.subscription.updated(active).
  await stripe.testHelpers.testClocks.advance(clock.id, {
    frozen_time: inDays(now, 15), // 1 jour après la fin d'essai
  })
  sub = await stripe.subscriptions.retrieve(sub.id)
  console.log('J+15  :', sub.status) // 'active'

  // ── 5. AVANCER d'un mois : renouvellement ────────────────────────────────
  // (< 2 périodes de facturation par advance → OK)
  await stripe.testHelpers.testClocks.advance(clock.id, {
    frozen_time: inDays(now, 46),
  })
  sub = await stripe.subscriptions.retrieve(sub.id)
  console.log('J+46  :', sub.status) // 'active' — renouvelé
}

main().catch((e) => {
  console.error('Erreur :', e.message)
  process.exit(1)
})
```

**Ce qu'il faut observer dans `stripe listen`** (lancé AVANT) :

```
customer.subscription.created     ← trialing
customer.subscription.trial_will_end (≈ 3 j avant J+14)
invoice.paid                      ← 1re facture à la fin d'essai
customer.subscription.updated     ← passe à active
invoice.paid                      ← renouvellement à J+45
```

**Pourquoi c'est correct :** le customer est **rattaché à l'horloge** (`test_clock`), donc son abonnement suit le temps simulé ; on avance **par paliers** (jamais plus de 2 périodes) ; la carte `pm_card_visa` **réussit**, donc le renouvellement passe. Pour tester l'**échec**, on referait le scénario avec `pm_card_chargeCustomerFail` (ou une carte de refus) et on observerait `invoice.payment_failed` + le dunning (module 07).

### Exemple 2 — assembler et prouver le flux TribuZen Premium

On ne **déclare** pas « le billing marche », on le **prouve**. Voici le parcours de bout en bout et ses trois preuves.

**Le parcours (assemblage des modules 00-08) :**

```
1. Un parent Free clique « Passer à Premium »           (gate module 06 : il est Free)
2. TribuZen crée une Checkout Session mode subscription (module 02, metadata.userId)
3. Il paie avec 4242 4242 4242 4242                      (carte de test, module 09)
4. Stripe POST checkout.session.completed + subscription.created (webhook, module 03)
5. TribuZen passe la famille en Premium SUR LE WEBHOOK    (jamais sur le success_url)
6. Le parent ouvre le Customer Portal, passe mensuel→annuel (module 05 + proration module 04)
7. Sa carte expire → invoice.payment_failed → past_due → relance (dunning, module 07)
8. Une facture PDF conforme TVA est disponible           (module 08)
```

**Preuve a — le webhook décide, pas le navigateur (idempotence) :**

```bash
# rejouer DEUX FOIS le même type d'event → l'effet ne doit PAS doubler
stripe trigger checkout.session.completed
stripe trigger checkout.session.completed
# logs attendus : 1er event traité ; 2e event "déjà traité — ignoré" (event.id, module 03)
```

**Preuve b — le cycle complet sans attendre (test clock, Exemple 1) :** l'abonnement passe `trialing → active → renouvelé` en secondes, les `invoice.paid` apparaissent, et sur une carte qui échoue on voit `invoice.payment_failed` déclencher le `past_due`.

**Preuve c — la gate est réelle :** un utilisateur Free reçoit `403` sur une fonctionnalité Premium ; après le webhook d'activation, la **même** requête passe. La gate lit le **tier persisté par le webhook** (module 06), pas une supposition front.

**La checklist go-live, déroulée (extrait) :**

```
[ ] sk_test_/pk_test_ remplacées par sk_live_/pk_live_ via le secret manager (rien dans le repo)
[ ] version d'API épinglée (2026-06-24) et constante
[ ] endpoint webhook LIVE créé dans le Dashboard → nouveau whsec_ (≠ celui de stripe listen)
[ ] Products/Prices/Portal/Tax recréés en LIVE (mêmes identifiants logiques)
[ ] clés rotées avant le lancement (exposition dev possible) ; .env dans .gitignore
[ ] monitoring : alerte sur séries d'invoice.payment_failed + échecs de signature
```

**Ce que ça prouve :** un flux qui survit à un event **rejoué** (idempotent), à un **cycle temporel compressé** (test clock), et à une **gate testée** — puis passé au crible de la checklist — est **prêt**. « Ça a marché une fois dans le Dashboard test » ne prouve rien.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire que les objets test sont réutilisables en live

```
❌ le price_... créé en test → utilisé tel quel en live → "No such price" en production
✅ recréer Products/Prices EN LIVE ; lire les IDs depuis la config d'env, jamais en dur
```

Test et live sont **étanches** (§2.1). Aucun Product, Price, webhook, customer n'est partagé. Le go-live **recrée** tout en live. Symptôme classique : « ça marchait en test, en prod ça hurle `No such price` ».

### PIÈGE #2 — Réutiliser le `whsec_` de `stripe listen` en production

```
❌ le whsec_ imprimé par `stripe listen` (local) collé dans le .env de PROD → toutes les signatures échouent
✅ en live, créer un endpoint webhook dans le Dashboard → il a SON PROPRE whsec_ live
```

Le secret de `stripe listen` est **local et temporaire**. L'endpoint webhook **live** (Dashboard) a un secret **distinct** (§2.3, §2.6). Les confondre → `constructEvent` échoue sur 100 % des events en prod.

### PIÈGE #3 — Oublier de lancer `stripe listen` avant de déclencher

```
❌ stripe trigger checkout.session.completed   (mais aucun listen actif) → event dans le vide
✅ Terminal 1: stripe listen --forward-to ...   PUIS   Terminal 2: stripe trigger ...
```

Le `trigger` envoie l'event **maintenant**. Si le listener n'écoute pas encore, ton endpoint ne le reçoit jamais (§2.3). Ordre : `listen` d'abord, toujours.

### PIÈGE #4 — Avancer un test clock trop loin d'un coup

```
❌ advance de +6 mois d'un seul appel avec un abonnement mensuel → erreur (max 2 périodes)
✅ avancer PAR PALIERS : +1 mois, re-advance +1 mois, etc.
```

Un `advance` couvre **au plus 2 périodes de facturation** (§2.4). Pour simuler un an d'abonnement mensuel, on enchaîne les paliers. Le temps ne recule jamais.

### PIÈGE #5 — Tester le flux sans tester l'idempotence

```
❌ "le webhook a marché une fois" → mais Stripe REJOUE les events (retries jusqu'à 3 jours)
✅ rejouer le même event (stripe trigger x2, ou re-advance) → vérifier ZÉRO double effet
```

Stripe garantit **au moins une** livraison, pas exactement une (module 03). Un test qui ne rejoue jamais un event ne prouve pas l'idempotence — le bug (double activation, double email) n'apparaît qu'en prod, sous retry réseau.

### PIÈGE #6 — Ne PAS rotater les clés avant le go-live

```
❌ garder les clés utilisées pendant tout le dev (logs, captures, commits) → surface d'exposition
✅ rotater les clés AVANT le lancement (checklist officielle Stripe), puis rotation régulière
```

Une clé qui a vécu tout le développement a pu fuiter dix fois (§2.7). La checklist Stripe **exige** une rotation avant le live. Rotater = créer la nouvelle, déployer, **puis** révoquer l'ancienne (jamais l'inverse, sous peine de coupure).

### PIÈGE #7 — Utiliser une vraie carte « juste pour vérifier »

```
❌ tester avec sa propre CB en mode test → soit ça ne marche pas, soit (en live) on se facture soi-même
✅ mode test = cartes de test (4242…, 4000…) et PaymentMethods de test (pm_card_visa) UNIQUEMENT
```

En test, une vraie carte est refusée ; en live, elle **débite réellement**. Les numéros de test (§2.2) sont déterministes et gratuits. Ne jamais mélanger.

### PIÈGE #8 — Confondre « tester en test mode » et « prêt pour la prod »

Passer en test mode ne suffit pas : il reste la **checklist go-live** (clés live, webhooks live, objets recréés, monitoring, rotation). Le mode test **prouve la logique** ; la checklist **prépare la prod** (§2.6, §2.9). Sauter la checklist, c'est livrer un flux logiquement correct sur une infra non sécurisée.

---

## 5. Ancrage TribuZen

Ce module **est** l'ancrage : le flux **TribuZen Premium** entier, testé puis mis en live. Emplacement cible dans `smaurier/tribuzen` :

```
tribuzen-api/
  src/
    main.ts                              ← rawBody: true (webhook, module 03)
    billing/
      stripe.provider.ts                 ← SDK injectable, clé depuis secret manager (module 00)
      checkout.controller.ts             ← crée la Checkout Session (module 02)
      stripe-webhook.controller.ts       ← signature (module 03)
      stripe-webhook.service.ts          ← routage + idempotence (module 03)
      subscription.service.ts            ← cycle de vie (module 04)
      portal.controller.ts               ← Customer Portal (module 05)
      entitlements.guard.ts              ← gates freemium (module 06)
      dunning.service.ts                 ← past_due + relances (module 07)
  scripts/
    simulate-lifecycle.js                ← Exemple 1 (test clock) — mode test uniquement
  GO-LIVE.md                             ← la checklist du §2.6, cochée avant vendredi
  .env                                   ← clés (JAMAIS commité — .gitignore)
```

Grille récapitulative — chaque preuve TribuZen, son outil, son module :

| Preuve à apporter | Outil | Module |
|---|---|---|
| Le paiement aboutit | carte de test `4242 4242 4242 4242` | 09 |
| Le 3DS est géré | carte `4000 0025 0000 3155` | 09 |
| Le webhook active Premium (pas le success_url) | `stripe listen` + logs | 03, 09 |
| L'event rejoué ne double pas l'effet | `stripe trigger` x2 | 03, 09 |
| Le cycle trial→renouvellement→échec tient | **test clock** (`advance`) | 04, 07, 09 |
| La gate Premium est réelle (403 → 200) | requête Free puis Premium | 06, 09 |
| La bascule live est sûre | **checklist go-live** + rotation | 09 |

> C'est le **dernier maillon** : après ce module, TribuZen Premium n'est plus une démo test, c'est un flux **prouvé** prêt à encaisser — à condition que la checklist soit cochée et les clés en sécurité.

---

## 6. Points clés

1. **Test et live sont étanches** : aucun objet (Product, Price, webhook, customer) n'est partagé — le go-live **recrée** tout en live, IDs lus depuis la config d'env.
2. Les **cartes de test** sont déterministes : `4242…` réussit, `4000 0025 0000 3155` force le 3DS, `4000…0002` est refusée ; `pm_card_visa` pour les tests serveur.
3. La **Stripe CLI** route (`stripe listen --forward-to`) et déclenche (`stripe trigger`) les webhooks en local ; `listen` **imprime le `whsec_` local** — lancé **avant** tout `trigger`.
4. Les **test clocks** (`testHelpers.testClocks.create` / `.advance`) simulent le temps : trial → renouvellement → échec en secondes ; on avance **par paliers** (≤ 2 périodes).
5. Tester le flux = **tester les webhooks**, idempotence incluse : rejouer un event ne doit **jamais** doubler l'effet (module 03).
6. La **checklist go-live** : bascule des clés, version d'API épinglée, **webhook live séparé** (nouveau `whsec_`), objets recréés en live, monitoring, rotation.
7. **Rotation des secrets obligatoire** avant le live (exposition dev possible) ; aucune clé en dur, `.env` dans `.gitignore`, `sk_live_` fuité = compromis, à révoquer.
8. Test et live sont **volontairement identiques** en comportement : le **code** ne change pas — seules changent les **clés**, les **IDs** et le **secret webhook**.
9. Le capstone **assemble** les modules 00-08 en un flux Premium unique et le **prouve** (event rejoué, cycle compressé, gate testée), avant de dérouler la checklist.

---

## 7. Seeds Anki

```
Les objets Stripe créés en mode test sont-ils utilisables en live ?|Non. Test et live sont étanches : Products, Prices, webhooks, customers ne sont PAS partagés. Au go-live on recrée tout en live (mêmes identifiants logiques) et les IDs se lisent depuis la config d'env, jamais en dur.
Quelle carte de test pour un paiement réussi, et laquelle force le 3D Secure ?|Succès : 4242 4242 4242 4242. 3D Secure / SCA requis : 4000 0025 0000 3155 (ou 4000 0027 6000 3184 pour 3DS à chaque transaction). Refus générique : 4000 0000 0000 0002. Date future quelconque, CVC 3 chiffres quelconques.
À quoi sert `stripe listen --forward-to` et que faut-il en récupérer ?|Il route les webhooks Stripe vers ton endpoint local (que Stripe ne peut pas atteindre sur localhost) et IMPRIME le secret de signature local (whsec_...) à mettre dans .env pour que constructEvent valide les signatures. À lancer AVANT tout stripe trigger.
Qu'est-ce qu'un test clock et quelles sont ses 3 opérations ?|Une horloge simulée pour tester les abonnements dans le temps sans attendre. 1) créer : testHelpers.testClocks.create({frozen_time}). 2) rattacher : créer le customer avec {test_clock}. 3) avancer : testHelpers.testClocks.advance(id, {frozen_time}). Le temps n'avance que vers l'avant, ≤ 2 périodes de facturation par advance.
Comment prouver qu'un handler webhook est idempotent en test ?|Rejouer le même event (stripe trigger x2, ou avancer/rejouer un test clock) et vérifier ZÉRO double effet : le 2e event est "déjà traité — ignoré" via event.id. Stripe garantit au moins une livraison (retries jusqu'à 3 jours), pas exactement une.
Le whsec_ de `stripe listen` peut-il servir en production ?|Non. C'est un secret LOCAL et temporaire. En live, on crée un endpoint webhook dans le Dashboard qui a son PROPRE whsec_ (distinct). Les confondre fait échouer constructEvent sur 100% des events en prod.
Cite 4 points de la checklist go-live Stripe.|1) Basculer sk_test_/pk_test_ vers sk_live_/pk_live_ via secret manager (rien dans le repo). 2) Créer un webhook LIVE séparé (nouveau whsec_). 3) Recréer Products/Prices/Portal/Tax en live. 4) Rotater les clés avant le lancement + monitoring (logs, alertes sur invoice.payment_failed). Épingler aussi la version d'API.
Pourquoi rotater les clés API avant le go-live ?|Parce qu'une clé utilisée pendant tout le dev a pu fuiter (logs, captures, commit accidentel). La checklist Stripe l'exige. Rotation = créer la nouvelle clé, déployer, PUIS révoquer l'ancienne (jamais l'inverse, sous peine de couper le service). Un sk_live_ poussé sur un repo est compromis, à révoquer.
Qu'est-ce que le go-live NE change PAS dans le code ?|Presque rien : test et live sont volontairement identiques en comportement. Le SDK, constructEvent, le routage d'events, les gates sont les mêmes. Seules changent les clés, les IDs d'objets (recréés en live) et le secret webhook.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-09-testing-et-mise-en-production/README.md`. **Capstone** : assembler le flux **TribuZen Premium** de bout en bout (produits → checkout → webhook → abonnement → portail → gate → facture), le **prouver** avec les cartes de test, la **Stripe CLI** (`listen`/`trigger`) et un **test clock** (trial → renouvellement → échec compressés), puis dérouler la **checklist go-live** (bascule des clés, webhook live, rotation des secrets, monitoring). Cahier des charges, jalons, grille exigeante, coach en session (≥ 3 checkpoints), variante J+30. Vrai SDK Stripe en **mode test**, zéro harnais simulé, clés = placeholders cassés.

---

> **Note :** ce module est le **dernier du parcours 22-stripe-billing**. Le `next` pointe vers `fin-parcours-22-stripe-billing` — tu as couvert l'intégralité du cours billing, du premier appel API Stripe (module 00) jusqu'à un flux **TribuZen Premium** entier : catalogue, checkout, webhook signé et idempotent, cycle de vie d'abonnement, portail self-service, gates freemium, dunning, facturation conforme — **testé** (cartes, CLI, test clocks) et **mis en production sans se faire piéger** (clés, webhooks live, rotation, monitoring).

← [Module 08 — Facturation, taxes et légalité](08-facturation-taxes-et-legalite.md)
