---
titre: Facturation, taxes et légalité (Stripe, principes — pas conseil juridique)
cours: 22-stripe-billing
notions: ["factures automatiques Stripe", "numéro de facture séquentiel", "TTC / HT / TVA sur la facture", "SIREN et mentions vendeur", "sequencing account-level vs customer-level", "invoice_creation sur Checkout", "TVA et Stripe Tax (survol)", "ce que Stripe ne fait PAS (déclaration/reversement)", "DPA Stripe (sous-traitant RGPD)", "localisation des données", "mentions légales paiement et CGV", "PCI — ne jamais stocker les cartes soi-même", "ne pas calculer la TVA à la main", "conservation des factures", "renvoi à expert-comptable / juriste / DPO"]
outcomes:
  - "sait activer et configurer les factures automatiques Stripe (numérotation séquentielle, mentions vendeur, footer SIREN, TVA affichée)"
  - "sait expliquer ce que Stripe fait à ta place (PCI, émission de factures, dunning) et ce qu'il ne faut jamais coder soi-même"
  - "sait situer Stripe Tax et la TVA comme un survol, et sait quand renvoyer à un expert-comptable"
  - "sait pourquoi Stripe est un sous-traitant RGPD, où accepter le DPA et localiser les données"
  - "connaît les grandes catégories de mentions légales d'une facture FR et sait renvoyer à la source officielle plutôt que mémoriser des chiffres"
prerequis: [00-introduction-au-billing-saas, 01-stripe-products-et-prices, 02-stripe-checkout-et-payment-links, 03-webhooks-et-idempotence, 04-subscriptions-et-cycle-de-vie, 05-customer-portal-et-self-service, 06-freemium-et-feature-gating, 07-paiements-echoues-et-dunning]
next: 09-testing-et-mise-en-production
libs: [{ name: stripe, version: "latest" }]
tribuzen: back-office billing TribuZen — facturer légalement les abonnements Premium en France (factures automatiques conformes + posture RGPD sur Stripe sous-traitant)
last-reviewed: 2026-07
---

<!-- FLAG-REVIEW: légal/fiscal/RGPD facturation — valider par Sylvain + expert avant diffusion -->

# Facturation, taxes et légalité (principes, pas conseil juridique)

> **Outcomes — tu sauras FAIRE :** activer et configurer les factures automatiques Stripe, expliquer ce que Stripe assume à ta place (PCI, émission, dunning), situer la TVA / Stripe Tax en survol, et poser une base RGPD saine (DPA, localisation des données).
> **Difficulté :** :star::star:
>
> **⚠️⚠️ Module SENSIBLE — légal / fiscal / RGPD.** Ce module explique des **principes techniques** pour brancher Stripe proprement. **Ce n'est PAS du conseil juridique, fiscal ou comptable.** Les obligations réelles (taux de TVA, seuils de franchise, durée de conservation, clauses de CGV, base légale RGPD) **dépendent de ta situation et changent dans le temps**. Avant toute mise en production réelle : fais valider par un **expert-comptable**, un **juriste** et, pour le RGPD, un **DPO**. Les chiffres cités ici sont des ordres de grandeur illustratifs, jamais des vérités figées — la source de vérité est **officielle** (`service-public.gouv.fr`, `impots.gouv.fr`) + ton expert.

## 1. Cas concret d'abord

TribuZen Premium fonctionne : une famille clique « Essayer 90 jours » (module 02), le webhook signé active Premium (module 03), le portail gère les changements (module 05), le dunning relance les échecs (module 07). Techniquement, l'argent rentre.

Puis la première vraie cliente écrit au support :

> « Bonjour, j'ai besoin de la **facture** de mon abonnement pour ma comptabilité. Vous pouvez me l'envoyer ? »

Et là, panique. Est-ce qu'on a émis une facture ? Est-ce qu'elle a un **numéro** ? Le bon **SIREN** ? La **TVA** au bon format ? A-t-on le droit de la générer soi-même en collant trois lignes dans un PDF ?

Réflexe de dev qui va coûter cher :

```ts
// ❌ NE JAMAIS FAIRE ÇA — générer une "facture" maison
const facture = `Facture n°${Math.random()}\nMontant : ${prix} €\nMerci !`;
// Numéro non séquentiel, pas de mentions légales, TVA calculée à la main… inexploitable et non conforme.
```

Une facture n'est pas un reçu joli : c'est un **document légal** avec des mentions obligatoires, une **numérotation séquentielle sans trou**, et des règles de **conservation**. Bonne nouvelle : Stripe sait émettre des factures conformes **à ta place**. Ce module montre comment les activer et les configurer — et surtout **où s'arrête ta responsabilité de dev** et où commence celle de l'expert-comptable.

---

## 2. Théorie complète, concise

### 2.1 Ce que Stripe fait à ta place (et que tu ne dois PAS coder)

La règle d'or de tout le cours, appliquée au légal/fiscal : **délègue à Stripe ce que Stripe fait déjà mieux et de façon conforme.**

| Tâche | Qui | Pourquoi tu ne la codes pas |
|---|---|---|
| Stocker les numéros de carte | **Stripe** | Conformité **PCI-DSS** (Stripe est certifié niveau 1). Stocker une carte toi-même = obligations PCI énormes + risque légal. |
| Chiffrer les données de paiement | **Stripe** | Idem PCI. La carte ne transite jamais par ton serveur (Checkout hébergé, module 02). |
| Authentification forte (3DS/SCA) | **Stripe** | Géré par Checkout / le moteur de paiement (module 07). |
| Retenter les paiements échoués (dunning) | **Stripe** | Smart Retries + emails de relance (module 07). |
| **Émettre des factures conformes** | **Stripe** | Numérotation séquentielle, mentions, PDF, envoi — le sujet de ce module. |
| Calculer la TVA selon la juridiction | **Stripe Tax** (option) | Ne calcule **jamais** un taux de TVA à la main (§2.5). |

> **Règle TribuZen :** dès qu'une tâche touche une **carte bancaire**, une **facture légale** ou un **calcul de taxe**, la réponse par défaut est « Stripe le fait ». Si tu es tenté de le coder toi-même, c'est un signal d'alerte.

### 2.2 Une facture = un document légal (pas un reçu)

En France, une facture entre professionnels/vers un client porte des **mentions obligatoires** et une **numérotation séquentielle continue** (pas de trou, pas de doublon). Les grandes **catégories** de mentions (source : `service-public.gouv.fr`, à vérifier pour ta situation) :

- **Identification & dates** : date d'émission, **numéro unique séquentiel**, date de la vente/prestation.
- **Vendeur** : nom / raison sociale, **SIREN**, forme juridique, adresse.
- **Acheteur** : identité et adresse.
- **Détail** : description, quantités, prix unitaires, **taux de TVA** applicable.
- **Montants** : total **HT**, taux et montant de **TVA**, total **TTC**.
- **TVA** : numéro de TVA intracommunautaire (vendeur, et acheteur selon les cas/seuils).

> **⚠️ Je ne liste pas ça comme une checklist exhaustive « prête à l'emploi ».** Les mentions exactes, leurs conditions et les seuils **dépendent de ton statut et évoluent**. Utilise la **source officielle** + ton **expert-comptable** pour figer la liste réelle. Ici, l'objectif est que tu **saches configurer Stripe pour qu'il les porte** — pas de te transformer en fiscaliste.

### 2.3 La numérotation séquentielle : account-level vs customer-level

Le numéro de facture est le point le plus sensible techniquement : il doit être **séquentiel et sans trou**. Stripe gère deux systèmes de numérotation :

- **Account-level sequencing** : un même préfixe pour tout le compte, numéros séquentiels **globaux** (`TRIBU-0001`, `TRIBU-0002`, `TRIBU-0003`…).
- **Customer-level sequencing** : un préfixe **par client**, séquence propre à chaque client (`AB12-0001`, `AB12-0002`…).

> **Point clé FR/UE (vérifié sur `docs.stripe.com`) :** pour un compte situé dans l'**UE ou au Royaume-Uni**, Stripe applique par défaut le **sequencing account-level**, précisément parce que la **réglementation TVA** impose une séquence unique et continue. Tu n'as normalement pas à le forcer, mais tu dois **savoir pourquoi** c'est ainsi et **ne pas** le contourner.

Configuration (dashboard) : `Settings → Billing → Invoices` — préfixe (3 à 12 caractères), prochaine séquence (`Next Invoice Sequence`), et la section **Invoice Tax Information** pour ton identité fiscale (SIREN/TVA). Le **footer** et un **mémo** par défaut y sont aussi.

### 2.4 Activer les factures automatiques

Deux leviers, complémentaires.

**a) Sur les abonnements** — un abonnement Stripe (module 04) génère **déjà** une **Invoice** à chaque cycle. C'est ce qui déclenche `invoice.paid` / `invoice.payment_failed` (modules 03 et 07). Tu n'as pas à créer la facture : tu configures son **rendu** (footer SIREN, TVA affichée, template) dans le dashboard.

**b) Sur un Checkout ponctuel** — pour un paiement one-off en mode `payment`, la facture n'est pas automatique : on l'active via `invoice_creation` sur la session (voir Worked example §3.1). Pour un Checkout en mode `subscription`, c'est l'abonnement qui porte les factures.

Enfin, active les **emails automatiques** Stripe (`Settings → Billing → Customer emails`) : confirmation de paiement, facture, relance d'échec, renouvellement à venir. C'est Stripe qui envoie la facture à la cliente du §1 — tu n'écris pas ce code.

> **⚠️ FLAG-DOC candidat :** les noms exacts des sous-menus du dashboard bougent. Le chemin `Settings → Billing → Invoices` et l'API (`invoice_creation`, `invoice_prefix`, `next_invoice_sequence`) sont ceux de la doc courante — **vérifie sur `docs.stripe.com`** avant de rédiger une procédure interne.

### 2.5 TVA & Stripe Tax — survol, et surtout ses limites

**Ne calcule jamais un taux de TVA à la main dans ton code.** Les taux, seuils et règles de territorialité (B2B/B2C, intra-UE, franchise en base) sont un champ d'expertise à part entière et **changent**.

**Stripe Tax** (option payante) automatise le **calcul** et la **collecte** de la taxe (TVA/GST/sales tax) en fonction de : type de produit (tax code), localisation du client, localisation du vendeur. Il s'active dans le dashboard, s'intègre à Checkout / Invoices / Subscriptions, et **suit tes seuils** d'obligation.

**Ce que Stripe Tax NE fait PAS (vérifié sur `docs.stripe.com/tax`) :** il ne **déclare pas** et ne **reverse pas** la taxe aux administrations à ta place. Il fournit le **calcul, la collecte et les rapports** ; **la déclaration et le paiement restent ta responsabilité** (souvent via ton expert-comptable ou un partenaire).

> **⚠️ SENSIBLE.** Savoir *si* tu dois collecter la TVA, à partir de quel **seuil**, à quel **taux**, sous quel **régime** (ex. franchise en base) : ce n'est **pas** une décision de dev. Le seuil de franchise et les taux **existent et bougent** — ne les code jamais en dur comme des constantes de vérité. Renvoie à `impots.gouv.fr` + **expert-comptable**. Côté technique, ton seul job : **activer Stripe Tax** si l'expert dit qu'il le faut, et **afficher correctement** HT/TVA/TTC sur la facture.

### 2.6 Stripe, sous-traitant RGPD : le DPA

Stripe traite des **données personnelles** de tes utilisateurs (email, moyen de paiement, historique). Au sens du RGPD :

- **Toi (TribuZen)** = **responsable de traitement** (tu décides des finalités).
- **Stripe** = **sous-traitant** (il traite « pour ton compte et selon tes instructions »).

Cette relation exige un **DPA** (Data Processing Agreement). Chez Stripe, le DPA fait partie de l'accord de services (`stripe.com/legal`) : en utilisant Stripe, tu y adhères — vérifie dans le dashboard (`Settings → …`) l'état et les addenda (transferts de données). Ce que le DPA encadre, d'après le document Stripe (à faire valider par un DPO) :

- Stripe traite **selon tes instructions** et pour les finalités que tu définis ;
- Stripe est certifié **PCI-DSS niveau 1** ;
- **notification d'incident** « sans délai injustifié » — Stripe indique un plafond de **48 h** pour les données couvertes par le RGPD (le legacy de ce cours disait « < 72 h » ; le document DPA courant dit **48 h**, à revérifier à la source) ;
- **transferts hors UE** encadrés par des mécanismes légaux (addendum de transfert), les données pouvant transiter vers Stripe aux États-Unis.

> **⚠️ SENSIBLE — RGPD.** Adhérer au DPA ne te rend pas « conforme RGPD » à toi seul. Base légale du traitement, information des utilisateurs, registre, droits d'accès/effacement côté TribuZen : c'est **ton** périmètre, à cadrer avec un **DPO/juriste**. Le DPA couvre la relation **avec Stripe**, pas toute ta conformité.

### 2.7 Localisation des données & mentions légales

- **Localisation des données** : selon ton exigence, Stripe permet de cadrer la région de traitement. Ne présente pas « tout est en Europe » comme acquis : **vérifie** la configuration réelle dans le dashboard et le DPA, avec le DPO.
- **Mentions côté produit** : la page pricing affiche un « Paiement sécurisé par Stripe » ; tes **CGV/CGU** et ta **politique de confidentialité** doivent mentionner **Stripe comme sous-traitant de paiement**. Le **droit de rétractation** (e-commerce B2C) doit figurer dans les CGV. La rédaction exacte de ces documents = **juriste**, pas dev.

### 2.8 Conservation des factures

Les factures émises doivent être **conservées** pendant une durée légale (plusieurs années ; la durée exacte et le format — papier/électronique — relèvent de la réglementation en vigueur, à confirmer sur `service-public.gouv.fr` + expert-comptable). Stripe conserve les factures dans le dashboard, mais **ne présume pas** que « c'est chez Stripe donc c'est bon » : ta politique d'archivage (export, sauvegarde, réversibilité si tu quittes Stripe) se décide avec l'expert. Côté dev, prévois de pouvoir **exporter** les factures (API / dashboard) — sans inventer de durée « figée » dans le code.

---

## 3. Worked examples

### Exemple 1 — Activer les factures sur un Checkout ponctuel

Pour un paiement one-off (mode `payment`), on active la création de facture et on porte les mentions vendeur dans le footer.

```ts
// src/billing/checkout.service.ts (extrait)
// Contexte : Checkout ponctuel. Pour un abonnement (mode 'subscription'),
// la facture est portée par l'abonnement lui-même — pas besoin de invoice_creation.
const session = await this.stripe.checkout.sessions.create({
  mode: 'payment',
  line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
  success_url: 'https://tribuzen.app/merci',
  cancel_url: 'https://tribuzen.app/pricing',

  // ── Activer l'émission d'une facture conforme par Stripe ──
  invoice_creation: {
    enabled: true,
    invoice_data: {
      description: 'Abonnement TribuZen Premium',
      // Le footer porte l'identité vendeur. Le SIREN réel se configure aussi
      // dans Settings → Billing → Invoices (Invoice Tax Information).
      footer: 'TribuZen SAS — SIREN configuré dans le dashboard Stripe',
      // Affichage de la taxe : on laisse Stripe (Tax) porter le calcul.
      rendering_options: { amount_tax_display: 'include_inclusive_tax' },
    },
  },
});
```

Points clés :
- On **n'invente pas** de numéro : Stripe l'attribue en séquence (account-level en UE, §2.3).
- Le SIREN et l'identité fiscale se posent **une fois** dans le dashboard, pas à chaque session.
- Le calcul de taxe reste à Stripe (Tax), on ne fait qu'en **demander l'affichage**.
- `invoice_creation` concerne le mode `payment`. En mode `subscription`, l'abonnement génère déjà les factures de cycle.

> Vérifie les noms exacts (`invoice_creation`, `rendering_options.amount_tax_display`) sur `docs.stripe.com` — API sujette à évolution. Sinon `<!-- FLAG-DOC -->`.

### Exemple 2 — Une checklist de config (dashboard), pas du code

L'essentiel du travail légal/fiscal se fait **dans le dashboard**, une fois, pas dans le code. Voici la séquence de configuration TribuZen — **à faire valider avant go-live** :

```text
Settings → Billing → Invoices
  • Invoice Tax Information : raison sociale + SIREN + n° TVA (identité vendeur)
  • Préfixe + Next Invoice Sequence : numérotation (account-level en UE — ne pas contourner)
  • Footer / Mémo par défaut : mentions vendeur

Settings → Billing → Customer emails
  • Successful payments  (confirmation + facture)
  • Failed payments      (relance dunning, module 07)
  • Upcoming renewals    (renouvellement à venir)

Settings → Tax (Stripe Tax)
  • Activer UNIQUEMENT si l'expert-comptable le préconise
  • Assigner les tax codes aux produits — jamais de taux en dur dans le code

Settings (RGPD / légal)
  • Vérifier l'adhésion au DPA + addenda de transfert (avec le DPO)
  • Vérifier la localisation des données configurée
```

Ce « worked example » est volontairement une **procédure**, pas du code : c'est le rappel que 90 % de la conformité de facturation se règle par **configuration Stripe + validation expert**, et non par des lignes que tu écris.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Générer une facture « maison »

```ts
// ❌ Un PDF fait main : numéro non séquentiel, mentions manquantes, non conforme
const num = `INV-${Date.now()}`; // trous, doublons possibles → invalide légalement
```

Une facture est un document légal avec **numérotation séquentielle continue** et mentions obligatoires. Laisse Stripe l'émettre (`invoice_creation` / abonnement). Ton code ne fabrique **jamais** un numéro de facture.

### PIÈGE #2 — Calculer la TVA à la main

```ts
// ❌ Taux "codé en dur" comme une vérité — faux dès que le taux/seuil/régime change
const tva = montantHT * 0.20;
```

Les taux, seuils et règles de territorialité **changent** et dépendent de la situation. Utilise **Stripe Tax** (si l'expert le préconise) et renvoie à `impots.gouv.fr` + expert-comptable pour le **si/combien**. Le dev n'arbitre pas la fiscalité.

### PIÈGE #3 — Croire que « le paiement marche » = « je suis conforme »

Encaisser techniquement ≠ facturer légalement ≠ être conforme RGPD. Trois périmètres distincts : **paiement** (Stripe), **facturation** (Stripe + config + expert-comptable), **RGPD** (DPA Stripe + **ta** conformité avec un DPO). Ne les confonds pas.

### PIÈGE #4 — « J'ai signé le DPA, donc je suis RGPD-compliant »

Le DPA couvre la relation **avec Stripe** (sous-traitant). Il ne couvre **pas** ta base légale, l'information des utilisateurs, le registre des traitements, ni la gestion des droits côté TribuZen. Ça, c'est **ton** périmètre, à cadrer avec un DPO/juriste.

### PIÈGE #5 — Stocker ou logguer des données de carte

```ts
// ❌ Ne JAMAIS toucher au numéro de carte : obligations PCI massives + risque légal
logger.log(`Paiement carte ${cardNumber}`); // interdit
```

La carte ne transite jamais par ton serveur (Checkout hébergé, module 02). Stripe assume PCI-DSS. Si tu vois un PAN dans ton code/tes logs, c'est un incident.

### PIÈGE #6 — Prendre les chiffres de ce module pour argent comptant

Les durées de conservation, seuils de franchise, taux de TVA, le « 48 h » du DPA : ce sont des **ordres de grandeur datés**, pas des constantes. Ils **évoluent**. La source de vérité est **officielle** (`service-public.gouv.fr`, `impots.gouv.fr`, `docs.stripe.com`) + ton **expert**. Ne les fige jamais dans le code ni dans une doc interne sans revalidation.

---

## 5. Ancrage TribuZen

Objectif concret : **facturer légalement les abonnements Premium en France**, sans transformer un dev en fiscaliste.

Dans le back-office billing TribuZen, ce module ne rajoute **presque pas de code** — et c'est le message :

```text
tribuzen-api/
  src/
    billing/
      checkout.service.ts        ← invoice_creation sur les Checkout ponctuels (rare)
      stripe-webhook.service.ts  ← écoute déjà invoice.paid / invoice.payment_failed (modules 03/07)
docs/
  compliance/
    facturation-checklist.md     ← la procédure dashboard du §3.2, VALIDÉE par l'expert
    dpa-rgpd.md                  ← état DPA + localisation données, VALIDÉ par le DPO
```

Ce que TribuZen délègue à Stripe : émission des factures (séquence account-level UE), envoi par email, dunning, PCI, 3DS. Ce que TribuZen **décide avec des experts** : activer ou non Stripe Tax, régime de TVA, contenu des CGV/politique de confidentialité, durée d'archivage, base légale RGPD.

> **⚠️ Rappel gate SENSIBLE :** aucune de ces décisions ne se prend « au feeling » côté dev. La `facturation-checklist.md` et `dpa-rgpd.md` de TribuZen portent en tête le même avertissement que ce module : **principes, pas conseil juridique — valider par expert-comptable / juriste / DPO avant diffusion.**

---

## 6. Points clés

1. Une facture est un **document légal** (numéro séquentiel continu + mentions obligatoires), pas un reçu : **Stripe l'émet**, ton code n'en fabrique jamais le numéro.
2. En **UE/UK**, Stripe numérote en **account-level** parce que la réglementation TVA l'exige — ne pas contourner.
3. Factures automatiques : portées par l'**abonnement** (cycle) ; pour un Checkout ponctuel, activées via **`invoice_creation`**. Identité vendeur (SIREN/TVA) + footer se configurent **dans le dashboard**.
4. **Ne calcule jamais la TVA à la main.** Stripe Tax **calcule et collecte** ; il ne **déclare pas** et ne **reverse pas** — ça reste ta responsabilité (via expert-comptable).
5. Stripe est **sous-traitant RGPD** : adhésion au **DPA**, vérifier localisation des données et addenda de transfert — avec un **DPO**.
6. Signer le DPA ≠ être conforme RGPD : base légale, information, registre, droits utilisateurs = **ton** périmètre.
7. Ce que Stripe fait à ta place : **PCI** (jamais stocker/logguer une carte), émission de factures, dunning, 3DS.
8. Les chiffres (taux, seuils, durées, « 48 h ») sont **datés et changeants** : source officielle + **expert**, jamais figés dans le code.

---

## 7. Seeds Anki

```
Pourquoi ne jamais générer une facture "maison" dans son code ?|Une facture est un document légal : numérotation séquentielle continue (sans trou/doublon) + mentions obligatoires (SIREN, HT/TVA/TTC, dates…). Stripe l'émet de façon conforme via invoice_creation ou l'abonnement. Le code ne fabrique jamais le numéro.
Pourquoi Stripe numérote-t-il les factures en account-level en UE/UK ?|Parce que la réglementation TVA impose une séquence unique et continue au niveau du compte. Stripe applique account-level sequencing par défaut pour les comptes UE/UK ; on ne le contourne pas.
Comment active-t-on une facture sur un Checkout ponctuel Stripe ?|Via invoice_creation: { enabled: true, invoice_data: {...} } sur la session en mode 'payment'. En mode 'subscription', c'est l'abonnement qui génère déjà les factures de cycle. (Vérifier les noms sur docs.stripe.com.)
Que fait Stripe Tax, et surtout que ne fait-il PAS ?|Il calcule et collecte la taxe (TVA/GST) selon type de produit + localisations, et suit les seuils. Il NE déclare PAS et NE reverse PAS aux administrations : déclaration/paiement restent ta responsabilité (via expert-comptable).
Pourquoi ne jamais calculer un taux de TVA en dur dans le code ?|Taux, seuils (franchise en base) et règles de territorialité changent et dépendent de la situation. On délègue à Stripe Tax (si l'expert le préconise) et on renvoie à impots.gouv.fr + expert-comptable pour le si/combien.
Quel est le rôle RGPD de Stripe et TribuZen ?|TribuZen = responsable de traitement (décide des finalités) ; Stripe = sous-traitant (traite pour ton compte, selon tes instructions). D'où l'obligation d'un DPA, à cadrer avec un DPO.
Signer le DPA Stripe suffit-il à être conforme RGPD ?|Non. Le DPA couvre la relation avec Stripe (sous-traitant). Base légale, information des utilisateurs, registre des traitements, droits d'accès/effacement côté TribuZen restent ton périmètre, avec un DPO/juriste.
Que fait Stripe à ta place côté sécurité/légal, et que tu ne dois pas coder ?|Stockage/chiffrement des cartes (PCI-DSS niveau 1 — ne jamais toucher/logguer un numéro de carte), émission de factures conformes, dunning, authentification forte 3DS/SCA.
Les chiffres légaux/fiscaux de ce module (taux, seuils, "48 h") sont-ils fiables durablement ?|Non : ce sont des ordres de grandeur datés et changeants. La source de vérité est officielle (service-public.gouv.fr, impots.gouv.fr, docs.stripe.com) + expert-comptable / juriste / DPO. Ne jamais les figer dans le code.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-08-facturation-taxes-et-legalite/README.md`. **README-only, sensible.** Configurer les factures automatiques Stripe en mode test (numérotation, identité vendeur, footer, emails) + produire une **checklist de conformité TribuZen** à faire valider par un expert. Grille + coaching + variante J+30, zéro harnais. Aucune vraie clé — placeholders uniquement.
