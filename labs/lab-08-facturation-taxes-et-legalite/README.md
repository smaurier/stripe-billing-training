<!-- FLAG-REVIEW: légal/fiscal/RGPD facturation — valider par Sylvain + expert avant diffusion -->
# Lab 08 — Facturation, taxes et légalité (principes, pas conseil juridique)

> **Outcome :** à la fin, tu sais **configurer les factures automatiques Stripe** en mode test (numérotation séquentielle, identité vendeur/SIREN, footer, emails) et **produire une checklist de conformité TribuZen** qui délègue au bon interlocuteur ce qui n'est pas du ressort d'un dev.
> **Vrai outil :** SDK `stripe` (npm) en **mode test** + **Dashboard Stripe** (mode test) + **Stripe CLI**. Pas de harnais simulé.
> **Feedback :** le coach valide en session — pas de test-runner auto-correcteur.
>
> **⚠️⚠️ Lab SENSIBLE — légal / fiscal / RGPD.** Ce lab enseigne des **principes techniques** de configuration Stripe. **Ce n'est PAS du conseil juridique, fiscal ou comptable.** La checklist que tu vas produire est un **brouillon technique à faire valider** par un **expert-comptable**, un **juriste** (CGV, rétractation) et un **DPO** (RGPD) avant toute diffusion ou mise en production. Les taux, seuils et durées cités sont des **ordres de grandeur datés** — la source de vérité est **officielle** (`service-public.gouv.fr`, `impots.gouv.fr`, `docs.stripe.com`) + ton expert.
>
> **⚠️ Clés.** Toutes les clés/secrets sont des **placeholders cassés** dans `.env` (jamais commité). Jamais de vraie `sk_test_…` versionnée.

---

## Énoncé

Tu finalises le back-office billing de **TribuZen Premium** : encaisser marche déjà (modules 02→07), il faut maintenant **facturer légalement les abonnements en France**. Deux livrables, complémentaires :

1. **Configuration Stripe (mode test)** — activer et vérifier les factures automatiques : numérotation séquentielle, identité vendeur (SIREN/TVA), footer, emails automatiques. Une petite portion de **code** (activer `invoice_creation` sur un Checkout ponctuel + inspecter la facture générée), le reste en **dashboard**.
2. **Checklist de conformité TribuZen** (`docs/compliance/facturation-checklist.md`) — un document qui, pour chaque point, indique **qui décide** : le dev (config Stripe), l'**expert-comptable** (TVA, conservation), le **juriste** (CGV, rétractation) ou le **DPO** (RGPD/DPA). Le but pédagogique n'est pas de « connaître le droit », mais de **savoir où s'arrête ta responsabilité**.

**Pas de gap-fill.** Tu configures dans le dashboard, tu écris le petit script d'inspection, et tu rédiges la checklist toi-même.

### Prérequis d'environnement

```bash
npm install stripe
# Stripe CLI : https://docs.stripe.com/stripe-cli
stripe login   # compte en mode TEST
```

`.env` (jamais commité — placeholders cassés, à remplacer par tes vraies clés de **test en local seulement**) :

```
STRIPE_SECRET_KEY=sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>
STRIPE_PRICE_ID=price_<REMPLACER-PAR-TON-PRICE-TEST>
```

> ⚠️ Ne committe jamais `.env`. Vérifie qu'il est dans `.gitignore` **avant** tout `git add`.

### Starter minimal

```ts
// scripts/inspect-invoice.ts — starter
// But : créer un Checkout ponctuel AVEC facture, puis inspecter la facture générée
// (numéro séquentiel, HT/TVA/TTC, footer). Mode test uniquement.
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

async function main() {
  // À toi :
  // 1. Créer une Checkout Session mode 'payment' avec invoice_creation activé.
  // 2. (En mode test) simuler le paiement, puis récupérer l'Invoice liée.
  // 3. Logguer : invoice.number, subtotal (HT), tax, total (TTC), footer.
}

main().catch((e) => { console.error(e.message); process.exit(1); });
```

---

## Étapes (en friction)

### Partie A — Configuration Stripe (dashboard, mode test)

1. **Identité vendeur** — `Settings → Billing → Invoices` → *Invoice Tax Information* : renseigne raison sociale, **SIREN**, n° TVA (valeurs de test/factices en mode test). Note le chemin exact : les libellés du dashboard bougent — vérifie sur `docs.stripe.com`.
2. **Numérotation** — repère le **préfixe** et *Next Invoice Sequence*. Constate que ton compte (si UE/UK) est en **account-level sequencing**. Écris **pourquoi** (réglementation TVA) — tu devras l'expliquer au coach.
3. **Footer / mémo** — ajoute un footer d'identité vendeur.
4. **Emails automatiques** — `Settings → Billing → Customer emails` : active *Successful payments*, *Failed payments*, *Upcoming renewals*.

### Partie B — Code d'inspection

5. **`invoice_creation`** — dans `scripts/inspect-invoice.ts`, crée une Checkout Session `mode: 'payment'` avec `invoice_creation: { enabled: true, invoice_data: { description, footer, rendering_options } }`.
6. **Payer en test** — ouvre l'`url` de la session, paie avec la carte de test `4242 4242 4242 4242`.
7. **Inspecter** — récupère l'Invoice (via l'API ou le dashboard) et logue : `number` (séquentiel), `subtotal`, `tax`, `total`, `footer`. Vérifie que **tu n'as généré aucun numéro toi-même**.

### Partie C — Checklist de conformité (le vrai livrable)

8. **Rédige `docs/compliance/facturation-checklist.md`** : pour chaque ligne, une colonne **« Qui décide »**. Distingue clairement : *config dev*, *expert-comptable*, *juriste*, *DPO*. Mets en tête le disclaimer « principes, pas conseil juridique — à valider avant diffusion ».
9. **RGPD** — ajoute une section DPA : Stripe = sous-traitant, où vérifier l'adhésion au DPA + localisation des données, et **ce qui reste ton périmètre** (base légale, information, registre, droits).
10. **Anti-chiffres-figés** — pour tout point avec un nombre (taux de TVA, seuil de franchise, durée de conservation, délai d'incident), n'écris **pas** le nombre comme une vérité : mets un lien vers la source officielle + « à confirmer par l'expert ».

---

## Corrigé complet commenté

> ⚠️ Corrigé **technique**. La checklist ci-dessous est un **modèle à faire valider** — pas une vérité juridique.

```ts
// scripts/inspect-invoice.ts — corrigé
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!); // sk_test_… depuis .env (jamais commité)

async function main() {
  // 1. Checkout ponctuel AVEC émission de facture par Stripe.
  //    (Pour un ABONNEMENT, la facture est portée par la subscription — pas besoin de ceci.)
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    success_url: 'https://tribuzen.app/merci',
    cancel_url: 'https://tribuzen.app/pricing',
    invoice_creation: {
      enabled: true, // ← Stripe émet une facture conforme (numéro séquentiel attribué par Stripe)
      invoice_data: {
        description: 'Abonnement TribuZen Premium',
        // Le SIREN "réel" se pose UNE FOIS dans le dashboard (Invoice Tax Information).
        footer: 'TribuZen SAS — SIREN configuré dans le dashboard Stripe',
        rendering_options: { amount_tax_display: 'include_inclusive_tax' },
      },
    },
  });
  console.log('Ouvre et paie (carte test 4242…) :', session.url);

  // 2. Après paiement (webhook invoice.paid, module 03), récupère la facture.
  //    En test, on peut lister les dernières factures du customer créé par le Checkout.
  const invoices = await stripe.invoices.list({ limit: 1 });
  const inv = invoices.data[0];
  if (!inv) { console.log('Aucune facture encore — paie d’abord la session.'); return; }

  // 3. Inspecter : on N'A RIEN calculé nous-mêmes — tout vient de Stripe.
  console.log({
    number: inv.number,     // ← numéro SÉQUENTIEL attribué par Stripe (jamais par toi)
    subtotalHT: inv.subtotal,
    tax: inv.total_taxes,           // ← calculé par Stripe Tax si activé, sinon 0/null
    totalTTC: inv.total,
    footer: inv.footer,
    hostedUrl: inv.hosted_invoice_url, // PDF conforme, envoyé au client par Stripe
  });
}

main().catch((e) => { console.error('Erreur :', e.message); process.exit(1); });
```

**Pourquoi ce corrigé est correct :**
- **Zéro numéro fait main** : `inv.number` vient de Stripe (séquence account-level en UE). Le code ne fabrique jamais d'identifiant de facture.
- **Zéro TVA en dur** : `inv.total_taxes` est porté par Stripe (Tax si activé). Aucun `* 0.20` dans le code.
- **Identité vendeur au bon endroit** : SIREN/TVA dans le dashboard (une fois), pas répété à chaque session.
- **La facture PDF conforme** (`hosted_invoice_url`) est produite et envoyée **par Stripe**, pas par ton serveur.
- Les noms d'API (`invoice_creation`, `rendering_options`, `inv.number`) sont ceux de la doc courante — **à revérifier sur `docs.stripe.com`** avant prod.

### Modèle de checklist (`docs/compliance/facturation-checklist.md`)

```markdown
<!-- FLAG-REVIEW: principes, PAS conseil juridique/fiscal/RGPD — valider par expert-comptable + juriste + DPO avant diffusion -->
# Conformité facturation TribuZen — checklist (brouillon technique)

> Ordres de grandeur datés, pas des vérités figées. Source de vérité : service-public.gouv.fr,
> impots.gouv.fr, docs.stripe.com + expert-comptable / juriste / DPO.

| Point | Fait quoi | Qui décide | Source à confirmer |
|---|---|---|---|
| Factures automatiques activées (abonnement + invoice_creation) | Config Stripe | **Dev** | docs.stripe.com |
| Numérotation séquentielle (account-level UE) | Config Stripe (ne pas contourner) | **Dev** | docs.stripe.com |
| SIREN / n° TVA / raison sociale sur la facture | Dashboard Invoice Tax Information | **Dev + expert-comptable** | expert-comptable |
| Faut-il collecter la TVA ? à quel taux / seuil ? | Décision fiscale — Stripe Tax si oui | **Expert-comptable** | impots.gouv.fr |
| Emails automatiques (confirmation, échec, renouvellement) | Config Stripe | **Dev** | docs.stripe.com |
| Mentions CGV / droit de rétractation (14 j B2C) | Rédaction contractuelle | **Juriste** | juriste |
| « Paiement sécurisé par Stripe » + Stripe sous-traitant dans la politique de confidentialité | Rédaction | **Juriste / DPO** | juriste |
| DPA Stripe (sous-traitant RGPD) accepté + addenda transferts | Vérifier dashboard/legal | **DPO** | stripe.com/legal |
| Localisation des données | Vérifier config Stripe | **DPO** | dashboard + DPA |
| Base légale, information, registre, droits utilisateurs | Conformité RGPD TribuZen | **DPO / juriste** | DPO |
| Conservation / archivage des factures (durée, export) | Politique d'archivage | **Expert-comptable** | service-public.gouv.fr |
```

---

## Grille de validation

| Critère | Attendu | OK ? |
|---------|---------|------|
| `.env` git-ignoré | `git status` ne liste jamais `.env` ; aucune vraie `sk_test_…` versionnée | ☐ |
| Facture émise par Stripe | `invoice_creation` activé ; `inv.number` provient de Stripe, non fabriqué | ☐ |
| Numéro séquentiel compris | L'apprenant sait dire pourquoi c'est account-level en UE (TVA) | ☐ |
| Identité vendeur au bon endroit | SIREN/TVA dans le dashboard, pas en dur/répété dans le code | ☐ |
| Zéro TVA calculée à la main | Aucun taux en dur ; `inv.total_taxes` vient de Stripe (Tax si activé) | ☐ |
| Emails automatiques activés | Confirmation / échec / renouvellement cochés en mode test | ☐ |
| Checklist « Qui décide » | Chaque ligne attribue dev / expert-comptable / juriste / DPO | ☐ |
| Disclaimer présent | Checklist porte le FLAG-REVIEW « pas conseil juridique » | ☐ |
| Anti-chiffres-figés | Les nombres (taux, seuils, durées, délais) renvoient à une source, pas figés | ☐ |
| Posture RGPD | Stripe = sous-traitant ; DPA ≠ conformité complète ; périmètre TribuZen identifié | ☐ |

---

## Coach — points à challenger en session

> Le coach ne corrige pas du code fourni : il vérifie l'**autonomie**, la **compréhension** et surtout le **réflexe de renvoyer à un expert**. Au moins 3 questions.

1. **« Montre-moi où est fabriqué le numéro de facture. »** — Attendu : nulle part dans le code ; c'est Stripe (`inv.number`), en séquence account-level. Creuser : pourquoi account-level en UE ? (réglementation TVA, séquence continue sans trou). Si l'apprenant a codé un `INV-${Date.now()}`, c'est rouge.
2. **« Un client te demande à quel taux de TVA tu le factures. Tu réponds quoi, et tu codes quoi ? »** — Attendu : *je ne tranche pas la fiscalité* ; c'est l'expert-comptable qui décide du régime/taux/seuil ; techniquement j'active Stripe Tax si l'expert le préconise et j'affiche HT/TVA/TTC. Aucun `* 0.20` en dur.
3. **« Tu as accepté le DPA Stripe. Tu es RGPD-compliant ? »** — Attendu : non. Le DPA couvre la relation avec Stripe (sous-traitant). Base légale, information des utilisateurs, registre, droits d'accès/effacement restent le périmètre TribuZen, à cadrer avec un DPO.
4. **« Dans ta checklist, qui décide de la durée de conservation des factures, et pourquoi tu n'as pas écrit le nombre d'années ? »** — Attendu : expert-comptable ; le nombre est daté/changeant → on renvoie à `service-public.gouv.fr`, pas de constante figée.
5. **« Où pourrait fuiter une donnée de carte dans ton flux, et comment tu garantis que non ? »** — Attendu : nulle part — Checkout hébergé (module 02), la carte ne touche jamais ton serveur ; PCI assumé par Stripe ; aucun PAN loggué.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé ni le module 08 :**

1. Reproduis la config + le script d'inspection **de mémoire, en 30 minutes**, sur un abonnement (mode `subscription`) : constate que la facture de cycle est générée **sans** `invoice_creation` (l'abonnement la porte), et retrouve son `number` séquentiel.
2. Active **Stripe Tax** en mode test, assigne un tax code au produit, et observe `inv.total_taxes` se remplir — **sans** écrire un seul taux dans le code. Explique au coach ce que Stripe Tax **ne fait pas** (déclaration/reversement).
3. Enrichis la checklist d'une ligne « **que se passe-t-il si TribuZen quitte Stripe ?** » (réversibilité : export des factures, archivage indépendant) — et identifie **qui décide** (expert-comptable + dev).

**Critère de réussite :** une facture d'abonnement conforme apparaît en mode test avec numéro séquentiel et TVA portée par Stripe ; la checklist attribue chaque décision au bon interlocuteur ; aucun chiffre fiscal n'est figé dans le code ; aucune vraie clé n'est versionnée.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ce lab se matérialise moins par du code que par de la **config + de la documentation validée** :

```
tribuzen-api/
  src/
    billing/
      checkout.service.ts        ← invoice_creation sur les Checkout ponctuels
      stripe-webhook.service.ts  ← écoute déjà invoice.paid / invoice.payment_failed (modules 03/07)
docs/
  compliance/
    facturation-checklist.md     ← la checklist ci-dessus, VALIDÉE par l'expert-comptable/juriste/DPO
    dpa-rgpd.md                  ← état DPA + localisation données, VALIDÉ par le DPO
```

**Différences par rapport au lab :**

- La config Stripe (SIREN, TVA, numérotation) se fait sur le **compte live** au go-live (module 09), avec des valeurs réelles validées par l'expert-comptable — pas les valeurs de test d'ici.
- La checklist n'est **pas** un artefact de dev isolé : elle est **revue et signée** par l'expert-comptable, le juriste et le DPO **avant** diffusion. Le `FLAG-REVIEW` reste tant que cette validation n'a pas eu lieu.
- Stripe Tax n'est activé en prod **que** sur préconisation de l'expert-comptable.
- Aucun secret (clé, `whsec_…`) n'est versionné : variables d'environnement du déploiement uniquement.

**Commit cible :**

```
docs(billing): factures automatiques Stripe + checklist conformité (à valider expert/juriste/DPO)
```
