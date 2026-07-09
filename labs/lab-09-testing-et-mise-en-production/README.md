# Lab 09 — Capstone : tester et mettre en production TribuZen Premium

> **Outcome :** à la fin, tu sais **assembler** le flux **TribuZen Premium** de bout en bout (produits → checkout → webhook → abonnement → portail → gate → facture), le **prouver** avec les cartes de test, la **Stripe CLI** et un **test clock**, puis dérouler une **checklist go-live** sûre — avec le vrai SDK Stripe en **mode test**.
> **Vrai outil :** SDK `stripe` (Node) en **mode test** + **Stripe CLI** (`stripe login`, `stripe listen`, `stripe trigger`) + **test clocks** (`stripe.testHelpers.testClocks`) + cartes de test (`4242 4242 4242 4242`, `4000 0025 0000 3155`, `pm_card_visa`). JAMAIS de harnais simulé, jamais de mock du SDK.
> **Feedback :** le coach valide en session (pas de test-runner auto-correcteur). **≥ 3 checkpoints** obligatoires (ci-dessous).

> **⚠️⚠️ Sécurité clés Stripe — capstone = mise en prod.** Aucune vraie clé dans ce repo, jamais, même en test. Les clés vivent dans un `.env` **jamais commité** (`.gitignore` : `.env`, `node_modules`). Dans tout fichier suivi par git, n'écris QUE des placeholders cassés : `sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>`, `whsec_<SECRET-WEBHOOK-EXEMPLE>`, `price_<TON-PRIX-TEST>`. Le `<` casse volontairement le pattern de détection de secret (GitHub push protection bloque `sk_live_`, `sk_test_`, `whsec_`…). Une `sk_live_` fuitée = **fraude immédiate** : on la considère compromise et on la **révoque**. Ce lab reste **intégralement en mode test** ; le go-live est déroulé **sur papier**.

---

## Énoncé

Tu es à J-2 du lancement payant. Le board veut **la preuve** que le flux TribuZen Premium tient, et une **bascule live sûre**. Tu vas donc, sur ton compte Stripe **de test** :

1. **Assembler** le flux complet en réutilisant les briques des modules 00-08 (rien de neuf : tu **branches**).
2. **Prouver** ce flux par trois épreuves : le webhook décide (pas le navigateur), l'idempotence tient (event rejoué), le cycle temporel tient (test clock : trial → renouvellement → échec).
3. **Rédiger** une checklist go-live cochée (`GO-LIVE.md`) : bascule des clés, webhook live séparé, objets recréés, rotation des secrets, monitoring.

**README-only : ce lab n'a pas de starter fourni.** Tu écris tout le code toi-même à partir de tes labs 00-08. C'est l'épreuve d'assemblage page blanche — si un maillon te bloque, **rouvre le module source**, ne devine pas.

### Pré-requis matériel

- Un compte Stripe en **mode test**.
- Les objets créés aux labs précédents : un **Product** Premium + deux **Prices** (mensuel, annuel) en test (lab 01).
- **Stripe CLI** installée, `stripe login` effectué.
- Ton **API NestJS** des labs 00-08 (au minimum : provider Stripe, controller checkout, controller + service webhook, guard d'entitlement) — ou un script Node autonome si tu montes le capstone hors NestJS.
- Un `.env` **non commité** :

```bash
# .env — NE JAMAIS COMMITTER (dans .gitignore)
STRIPE_SECRET_KEY=sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>
STRIPE_WEBHOOK_SECRET=whsec_<SECRET-DONNE-PAR-stripe-listen>
STRIPE_PRICE_PREMIUM_MONTHLY=price_<TON-PRIX-MENSUEL-TEST>
STRIPE_PRICE_PREMIUM_YEARLY=price_<TON-PRIX-ANNUEL-TEST>
```

### Cahier des charges (ce que le capstone doit démontrer)

| # | Exigence | Preuve attendue |
|---|---|---|
| C1 | Un Free peut souscrire via Checkout | Checkout Session `mode: subscription` payée avec `4242…` |
| C2 | Premium s'active **sur le webhook**, jamais sur le `success_url` | logs : `user.tier` change à la réception de `customer.subscription.*` |
| C3 | Le handler est **idempotent** | un event rejoué → « déjà traité — ignoré », aucun double effet |
| C4 | Le **cycle** trial → renouvellement → échec tient | **test clock** avancé par paliers ; `invoice.paid` puis `invoice.payment_failed` observés |
| C5 | Le 3DS est géré | Checkout avec `4000 0025 0000 3155` → écran d'authentification |
| C6 | La **gate** Premium est réelle | même requête : `403` en Free, `200` après activation |
| C7 | La bascule live est **documentée et sûre** | `GO-LIVE.md` coché (clés, webhook live, rotation, monitoring) |

**Aucun harnais simulé, aucun mock du SDK.** Toute preuve passe par le vrai SDK Stripe en test, la CLI et le Dashboard test.

---

## Étapes (en friction)

> Ordre imposé. À chaque **CHECKPOINT**, tu montres l'état au coach avant de continuer.

### Jalon A — Brancher et prouver le webhook (C1, C2, C3)

1. Lance l'écoute **avant tout** : `stripe listen --forward-to localhost:3000/webhooks/stripe`. Copie le `whsec_...` imprimé dans `.env`, démarre l'API.
2. Crée une Checkout Session `mode: subscription` (module 02) avec `metadata.userId`. Paie avec `4242 4242 4242 4242`.
3. Vérifie dans les logs : `checkout.session.completed` puis `customer.subscription.created` reçus, signature validée, `user.tier` passé à `premium` **sur le webhook**.
4. **Prouve l'idempotence** : `stripe trigger checkout.session.completed` **deux fois**. Le 2e doit être ignoré (`event.id` déjà vu). Aucun double email, aucune double activation.

> **CHECKPOINT 1 (coach).** Montre : le `whsec_` vient de `stripe listen`, l'activation part du webhook (pas du `success_url`), et le 2e event rejoué est ignoré. Le coach vérifie que tu **ne** décides **jamais** Premium sur la page de retour.

### Jalon B — Simuler le temps avec un test clock (C4)

5. Écris `simulate-lifecycle.js` : crée un **test clock** (`testHelpers.testClocks.create({ frozen_time })`), un customer **rattaché** (`{ test_clock }`) avec `pm_card_visa`, un abonnement mensuel `trial_period_days: 14`.
6. **Avance par paliers** : à J+15 (fin d'essai → `invoice.paid` → `active`), puis +1 mois (renouvellement). Rappelle-toi : **≤ 2 périodes par `advance`**, le temps ne recule jamais.
7. Observe dans `stripe listen` : `trial_will_end`, `invoice.paid`, `subscription.updated(active)`, `invoice.paid` (renouvellement).
8. **Rejoue pour l'échec** : refais le scénario avec une carte qui échoue (`pm_card_chargeCustomerFail`) et observe `invoice.payment_failed` → `past_due` → dunning (module 07).

> **CHECKPOINT 2 (coach).** Montre le cycle compressé : un abonnement passe `trialing → active → renouvelé` en secondes, et la variante « échec » déclenche `past_due`. Le coach vérifie que tu avances **par paliers** et que le rattachement `test_clock` est sur le **customer**.

### Jalon C — Gate réelle + checklist go-live (C5, C6, C7)

9. **3DS** : refais un Checkout avec `4000 0025 0000 3155`, franchis l'écran d'authentification, vérifie que l'abonnement s'active quand même.
10. **Gate** : appelle une route Premium en tant qu'utilisateur **Free** → `403`. Après activation par webhook, la **même** requête → `200`. La gate lit le tier **persisté** (module 06), pas une supposition front.
11. **Rédige `GO-LIVE.md`** : la checklist du module §2.6, chaque ligne cochée et justifiée (voir modèle ci-dessous).

> **CHECKPOINT 3 (coach).** Montre : le 3DS géré, la gate qui passe de `403` à `200`, et `GO-LIVE.md` complet. Le coach challenge chaque ligne : « où vit `sk_live_` ? », « le `whsec_` live est-il celui de `stripe listen` ? » (piège), « quand rotates-tu les clés ? ».

### Modèle `GO-LIVE.md`

```md
# TribuZen Premium — Checklist go-live (à cocher avant le lancement)

## Clés & secrets
- [ ] sk_test_/pk_test_ remplacées par sk_live_/pk_live_ via le secret manager (RIEN dans le repo)
- [ ] Clés ROTÉES avant le lancement (exposition dev possible) — nouvelle créée, déployée, ancienne révoquée
- [ ] .env dans .gitignore ; aucune clé en dur dans le code
- [ ] Version d'API Stripe épinglée (ex. 2026-06-24) et constante

## Webhooks
- [ ] Endpoint webhook LIVE créé dans le Dashboard → nouveau whsec_ (≠ celui de stripe listen)
- [ ] Handler tolère livraisons retardées / dupliquées / dans le désordre (idempotence, module 03)

## Objets (test ≠ live)
- [ ] Products, Prices (mensuel/annuel), config Portal, Stripe Tax recréés EN LIVE
- [ ] Price IDs lus depuis la config d'env (jamais en dur)

## Monitoring
- [ ] Dashboard : surveiller Events/Logs + échecs de livraison webhook
- [ ] Log côté serveur de chaque transition de tier (avec event.id)
- [ ] Alerte sur séries d'invoice.payment_failed et sur échecs de signature (constructEvent)
```

---

## Grille d'évaluation (exigeante)

Le coach coche. **Un seul ❌ sur une ligne 🔴 = capstone non validé** (à retravailler).

| # | Critère | 🔴 Bloquant | Statut |
|---|---|---|---|
| 1 | Aucune vraie clé nulle part ; placeholders cassés ; `.env` gitignored | 🔴 | ☐ |
| 2 | Premium s'active **sur le webhook**, jamais sur le `success_url` | 🔴 | ☐ |
| 3 | Signature vérifiée (`constructEvent` + raw body) avant tout traitement | 🔴 | ☐ |
| 4 | Idempotence prouvée : event rejoué → aucun double effet | 🔴 | ☐ |
| 5 | Test clock : cycle trial → active → renouvellement observé (par paliers) | 🔴 | ☐ |
| 6 | Variante échec : `invoice.payment_failed` → `past_due` déclenché | 🟠 | ☐ |
| 7 | 3DS géré avec `4000 0025 0000 3155` | 🟠 | ☐ |
| 8 | Gate réelle : `403` en Free, `200` après activation (tier persisté) | 🔴 | ☐ |
| 9 | `stripe listen` lancé **avant** tout `trigger` / script | 🟠 | ☐ |
| 10 | `GO-LIVE.md` complet : clés, webhook live séparé, rotation, objets recréés, monitoring | 🔴 | ☐ |
| 11 | Sait expliquer pourquoi le `whsec_` de `stripe listen` ≠ webhook live | 🟠 | ☐ |
| 12 | Zéro harnais simulé, zéro mock du SDK ; tout via SDK test + CLI + Dashboard | 🔴 | ☐ |

**Questions de contrôle orales (le coach en pose ≥ 3) :**
- Pourquoi un `price_...` de test ne marche pas en live ?
- Où placer `stripe listen` dans l'ordre, et pourquoi ?
- Combien de périodes un `advance` peut-il couvrir, et comment simuler 6 mois ?
- Quand, et dans quel ordre, rotates-tu une clé sans couper le service ?
- Comment prouves-tu l'idempotence plutôt que de la supposer ?

---

## Variante J+30 (fading)

**Même capstone, contraintes ajoutées, sans rouvrir ce README ni le module :**

1. **De mémoire, en 45 minutes**, remonte les jalons A→C et rejoue les preuves C2, C3, C4, C6.
2. **Ajoute une simulation de dunning complète** au test clock : carte `pm_card_chargeCustomerFail`, avance jusqu'à épuisement des relances Stripe, et vérifie la transition finale (`past_due` → `canceled` ou `unpaid` selon ta config) — explique au coach quelle stratégie de dunning tu as choisie (module 07).
3. **Écris un `runbook-incident.md`** : « un `sk_live_` a fuité sur un ticket public — que fais-tu, dans quel ordre, en combien de temps ? » (révocation, rotation, audit des logs Dashboard, communication).
4. **Contrainte finale :** ta checklist `GO-LIVE.md` doit tenir sans qu'aucune clé, même de test, n'apparaisse dans un fichier suivi par git — prouve-le avec un scan (`git grep -nE 'sk_(test|live)_[A-Za-z0-9]' -- . ':!*.md'` doit ne rien renvoyer d'exploitable).

**Critère de réussite :** les events attendus apparaissent dans `stripe listen`, le dunning atteint son état final, le runbook est actionnable (ordre + délais), et aucun secret réel n'existe dans le repo.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ce capstone **est** la mise en production :

```
tribuzen-api/
  src/billing/                 ← flux assemblé (modules 00-08), inchangé entre test et live
  scripts/simulate-lifecycle.js ← test clock, MODE TEST uniquement (jamais lancé en live)
  GO-LIVE.md                    ← checklist cochée avant le lancement
  runbook-incident.md           ← procédure de fuite de clé (variante J+30)
  .env                          ← clés — JAMAIS commité (.gitignore)
```

**Différences par rapport au lab :**

- En prod, les clés ne viennent **jamais** d'un `.env` sur disque mais du **secret manager** de la plateforme (Render/Railway/AWS Secrets Manager…), injecté au runtime.
- Le `whsec_` de production est celui de l'**endpoint webhook live** du Dashboard, **pas** celui de `stripe listen` (local).
- Le script de test clock ne tourne **que** contre les clés de test : le lancer contre du live n'a pas de sens (pas de test clock en live) et manipulerait de l'argent réel.
- Le monitoring (alertes sur `invoice.payment_failed`, échecs de signature) est branché sur l'observabilité de la prod, pas sur des `console.log`.

**Commit cible :**
```
feat(billing): capstone TribuZen Premium — flux prouvé (cartes de test, CLI, test clock) + checklist go-live
```

---

> **Note :** ce lab est le **dernier du parcours 22-stripe-billing**. Le boucler, c'est avoir un flux Premium **prouvé** — event rejoué sans double effet, cycle temporel compressé, gate réelle — et une **bascule live sûre** : clés en secret manager, webhook live séparé, secrets rotés, monitoring en place. TribuZen Premium est prêt à encaisser.
