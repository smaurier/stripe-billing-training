---
titre: Introduction au billing SaaS (Stripe + NestJS)
cours: 22-stripe-billing
notions: [pourquoi facturer, modèles économiques SaaS, freemium, abonnement, facturation à l'usage, panorama Stripe, "Stripe Payments", "Stripe Billing", "Stripe Checkout", "Customer Portal", mode test vs live, clés API, "sécurité des clés (sk_test / pk_test)", "configuration du SDK Stripe dans NestJS", premier appel API]
outcomes:
  - sait expliquer pourquoi et comment un SaaS facture (freemium, abonnement, usage)
  - sait situer les produits Stripe (Payments, Billing, Checkout, Customer Portal) et ce que chacun résout
  - sait distinguer mode test et mode live et reconnaître les préfixes de clés
  - sait configurer le SDK Stripe comme provider injectable dans NestJS en lisant la clé depuis .env
  - sait sécuriser les clés API et faire un premier appel Stripe en mode test
prerequis: []
next: 01-stripe-products-et-prices
libs: [{ name: stripe, version: "latest (API 2026-06-24)" }]
tribuzen: couche billing TribuZen — fondations du passage freemium vers abonnement famille (TribuZen Premium)
last-reviewed: 2026-07
---

# Introduction au billing SaaS (Stripe + NestJS)

> **Outcomes — tu sauras FAIRE :** expliquer les modèles de facturation SaaS, situer les produits Stripe, distinguer test/live, configurer le SDK Stripe dans NestJS et faire un premier appel en mode test.
> **Difficulté :** :star::star:

## 1. Cas concret d'abord

TribuZen fonctionne. Des centaines de familles l'utilisent gratuitement pour réduire leur charge mentale parentale. Mais l'hébergement, les notifications push et ton temps coûtent de l'argent — et le produit ne rapporte rien. Le board te confie une mission concrète :

> « On lance **TribuZen Premium** à 4,90 €/mois. Le plan gratuit reste, mais le partage illimité de tâches et le calendrier familial avancé passent en payant. Branche Stripe. Dans 3 mois on doit encaisser de vrais abonnements. »

Tu ouvres ton projet NestJS et tu bloques immédiatement sur des questions très concrètes :

- Est-ce que je code moi-même le formulaire de carte bancaire ? (Réponse : **non, jamais** — c'est un piège de conformité PCI.)
- Où mettre la clé secrète Stripe pour ne pas la fuiter sur GitHub ?
- Comment tester des paiements sans utiliser une vraie carte ?
- Que signifie « abonnement » côté Stripe : un produit ? un prix ? un client ?

Ce module ne code pas encore l'abonnement complet (c'est le fil des modules suivants). Il pose les **fondations** : comprendre le modèle économique, cartographier les briques Stripe, et **connecter proprement et de façon sécurisée** le SDK Stripe à ton NestJS en mode test. À la fin, tu auras fait ton **premier appel API Stripe** qui répond `200`.

---

## 2. Théorie complète, concise

### 2.1 Pourquoi facturer — et pourquoi c'est un vrai sujet technique

Facturer, ce n'est pas « ajouter un bouton payer ». C'est gérer un **état qui évolue dans le temps** : un client s'abonne, paie chaque mois, sa carte expire, il monte de plan, il annule, il revient. Ce cycle de vie doit rester synchronisé entre trois mondes : Stripe (la source de vérité du paiement), ta base de données (qui a le droit d'accéder à quoi), et l'expérience utilisateur. Le billing est le point où la technique rencontre directement le chiffre d'affaires : un bug ici = de l'argent perdu ou un client facturé à tort.

### 2.2 Les modèles économiques SaaS

Trois grands modèles, souvent combinés :

- **Freemium** — un socle gratuit + des fonctionnalités payantes. Le gratuit sert d'acquisition ; la conversion vers le payant fait le revenu. C'est le modèle **TribuZen** : gratuit pour tous, Premium pour le calendrier avancé et le partage illimité.
- **Abonnement (subscription)** — le client paie un montant récurrent (mensuel/annuel) pour un accès continu. Revenu prévisible (MRR — *Monthly Recurring Revenue*). C'est le cœur de la plupart des SaaS.
- **Facturation à l'usage (usage-based / metered)** — on paie ce qu'on consomme (nombre d'appels API, Go stockés, e-mails envoyés). Puissant mais **complexe** (compteurs, agrégation) — à éviter pour un MVP.

Un même produit combine souvent : freemium **pour** convertir, abonnement **comme** revenu de base, usage **en** surcouche pour les gros comptes. TribuZen commence en freemium → abonnement, l'usage viendra plus tard (offre B2B).

### 2.3 Panorama Stripe — quatre briques à ne pas confondre

Stripe n'est pas un produit unique mais une **suite**. Pour un billing d'abonnement, quatre briques suffisent :

- **Stripe Payments** — le moteur bas niveau qui encaisse un paiement (le *Payment Intent*, la gestion de la carte, la conformité PCI). Tout repose dessus, mais on l'utilise rarement seul pour un abonnement.
- **Stripe Billing** — la couche abonnements : *Products*, *Prices*, *Subscriptions*, *Invoices*. C'est elle qui sait qu'un client paie 4,90 €/mois, qui génère les factures et relance les échecs. **C'est le cœur de ce cours.**
- **Stripe Checkout** — une **page de paiement hébergée par Stripe**. Tu envoies l'utilisateur dessus, il saisit sa carte *sur les serveurs Stripe*, il revient. Tu n'héberges jamais le numéro de carte → conformité PCI drastiquement simplifiée.
- **Customer Portal** — un **espace client hébergé par Stripe** où l'utilisateur gère seul son abonnement (changer de carte, upgrader, annuler, télécharger ses factures). Zéro écran à coder côté toi.

> Règle d'or débutant : **Checkout** et **Customer Portal** sont des pages **hébergées par Stripe**. Tu les configures, tu rediriges l'utilisateur, tu ne codes pas le formulaire de carte. C'est ce qui te sort de l'enfer de la conformité PCI.

### 2.4 Mode test vs mode live

Chaque compte Stripe a **deux environnements totalement séparés** :

- **Mode test** — aucun argent réel ne circule. On paie avec des **cartes de test** (ex. `4242 4242 4242 4242`). Les objets créés (clients, abonnements) sont fictifs et isolés. C'est là qu'on développe.
- **Mode live** — vrais paiements, vraies cartes, vrai argent.

Les deux modes ont des **clés différentes** et des données **cloisonnées** : un client créé en test n'existe pas en live. On développe et on teste **exclusivement** en mode test, et on ne bascule en live qu'au go-live (module 09).

### 2.5 Les clés API et leurs préfixes

Une clé Stripe s'identifie à son préfixe :

| Clé | Test | Live | Exposable côté client ? |
|-----|------|------|-------------------------|
| **Publishable** (front) | `pk_test_…` | `pk_live_…` | **Oui** — c'est fait pour ça |
| **Secret** (back) | `sk_test_…` | `sk_live_…` | **Non — jamais** |
| **Restricted** (permissions limitées) | `rk_test_…` | `rk_live_…` | Non |

La **clé secrète** (`sk_…`) a **tous les droits** sur ton compte. Si elle fuite, quelqu'un peut lire tes clients et créer des remboursements. La **clé publishable** (`pk_…`) est conçue pour vivre dans le front (elle ne permet que des opérations inoffensives). Dans ce module côté NestJS (back), on utilise la **clé secrète de test**.

### 2.6 Sécurité des clés — la règle non négociable

La clé secrète ne doit **jamais** apparaître dans le code source ni être commitée. Elle vit dans un fichier `.env` **git-ignoré**, chargé au runtime :

```bash
# .env — JAMAIS commité (ajouté au .gitignore)
STRIPE_SECRET_KEY=sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>
```

```gitignore
# .gitignore
.env
node_modules
dist
```

En production, on préfère un **gestionnaire de secrets** (AWS Secrets Manager, variables d'environnement du PaaS) plutôt qu'un fichier. Bonnes pratiques additionnelles : préférer des **clés restreintes** (`rk_`) quand c'est possible, et **faire tourner** (rotate) une clé si elle a pu fuiter.

> GitHub scanne les push et **bloque** les vraies clés Stripe. Dans un support pédagogique, on n'écrit donc que des **placeholders cassés** comme `sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>` — le `<` casse volontairement le format détecté.

### 2.7 Configurer le SDK Stripe dans NestJS

Le SDK officiel est le paquet `stripe`. On l'expose comme **provider injectable** via une factory NestJS qui lit la clé depuis `ConfigService` :

```bash
npm install stripe @nestjs/config
```

```typescript
// src/stripe/stripe.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export const STRIPE_CLIENT = 'STRIPE_CLIENT';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STRIPE_CLIENT,
      useFactory: (config: ConfigService) => {
        const key = config.get<string>('STRIPE_SECRET_KEY');
        if (!key) {
          // Fail fast : mieux vaut crasher au démarrage qu'à la 1re requête paiement
          throw new Error('STRIPE_SECRET_KEY manquante dans .env');
        }
        return new Stripe(key, {
          apiVersion: '2026-06-24.dahlia', // version d'API épinglée (voir §2.8)
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [STRIPE_CLIENT],
})
export class StripeModule {}
```

On injecte ensuite le client Stripe partout où on en a besoin via le token `STRIPE_CLIENT`.

### 2.8 Version d'API épinglée

Stripe versionne son API par date (ex. version courante **`2026-06-24`**, nom de release *dahlia*). En **épinglant** `apiVersion`, tu garantis que le comportement de l'API et les types TypeScript ne changent pas sous tes pieds quand Stripe évolue. Le SDK Node **typé attend la chaîne complète avec le nom de release** : `apiVersion: '2026-06-24.dahlia'` (pas la date seule — le type TypeScript la refuserait). Sans `apiVersion`, le SDK utilise la version figée à sa date de publication — épingler explicitement reste plus prévisible.

### 2.9 Le premier appel API

Pour vérifier que la connexion fonctionne, l'appel le plus simple est `balance.retrieve()` : il ne crée rien, il lit juste le solde (nul en test), mais la réponse prouve que la clé est valide et le client bien câblé.

```typescript
const balance = await this.stripe.balance.retrieve();
// une réponse valide => clé OK + SDK correctement configuré
```

---

## 3. Worked examples

### Exemple 1 — Câbler Stripe dans NestJS et vérifier la connexion (TribuZen)

Objectif : au démarrage de l'app TribuZen, prouver que le SDK Stripe est bien connecté au compte en mode test.

**Étape 1 — le `.env` (git-ignoré) :**

```bash
# .env
STRIPE_SECRET_KEY=sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>
```

**Étape 2 — charger la config globalement :**

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StripeModule } from './stripe/stripe.module';
import { BillingService } from './billing/billing.service';

@Module({
  imports: [
    // isGlobal : ConfigService dispo partout sans réimporter ConfigModule
    ConfigModule.forRoot({ isGlobal: true }),
    StripeModule,
  ],
  providers: [BillingService],
})
export class AppModule {}
```

**Étape 3 — un service qui injecte le client et fait le premier appel :**

```typescript
// src/billing/billing.service.ts
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Stripe from 'stripe';
import { STRIPE_CLIENT } from '../stripe/stripe.module';

@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);

  // Injection par token — le provider STRIPE_CLIENT fournit l'instance Stripe
  constructor(@Inject(STRIPE_CLIENT) private readonly stripe: Stripe) {}

  // OnModuleInit : appelé une fois quand le module est prêt
  async onModuleInit(): Promise<void> {
    try {
      const balance = await this.stripe.balance.retrieve();
      // available[0]?.currency existe même si le solde est 0 en mode test
      this.logger.log(
        `Stripe connecté (devise: ${balance.available[0]?.currency ?? 'n/a'})`,
      );
    } catch (err) {
      // Si la clé est invalide, Stripe renvoie une erreur d'authentification
      this.logger.error('Connexion Stripe échouée — vérifie STRIPE_SECRET_KEY');
      throw err;
    }
  }
}
```

Au démarrage (`npm run start:dev`), le log `Stripe connecté …` confirme que tout est branché. Si la clé est absente ou fausse, l'app crashe **au démarrage** (fail fast) plutôt que lors du premier paiement d'un client.

### Exemple 2 — Choisir la bonne brique Stripe pour TribuZen Premium

Le board veut vendre TribuZen Premium à 4,90 €/mois. Décomposition en briques Stripe :

| Besoin | Brique Stripe | Module |
|--------|---------------|--------|
| Définir « Premium à 4,90 €/mois » | **Billing** : un *Product* + un *Price* récurrent | 01 |
| Encaisser le 1er paiement sans coder de formulaire carte | **Checkout** (page hébergée) | 02 |
| Rester synchro quand le paiement réussit vraiment | Webhooks (Payments/Billing) | 03 |
| Laisser le parent changer de carte / annuler | **Customer Portal** | 05 |

Conclusion : pour un abonnement freemium, on n'utilise **jamais** Stripe Payments « à la main ». On assemble **Billing + Checkout + Portal**, et les webhooks font le lien avec la base TribuZen. Ce module a posé la fondation (le client `stripe` injecté) sur laquelle tout ça se construit.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Coder soi-même le formulaire de carte bancaire

« Je vais faire un joli champ carte dans mon front. » **Non.** Manipuler un numéro de carte t'expose à la conformité **PCI-DSS**, lourde et risquée. Le correct : rediriger vers **Stripe Checkout** (page hébergée). Le numéro de carte ne touche jamais tes serveurs.

### PIÈGE #2 — Confondre clé publishable et clé secrète

`pk_…` (publishable) est **faite** pour être exposée dans le front. `sk_…` (secret) a **tous les droits** et ne doit **jamais** quitter le back ni apparaître dans le code. Mettre une `sk_` dans du code front est une fuite critique. Côté NestJS (back), on utilise `sk_test_…`.

### PIÈGE #3 — Committer le `.env` avec la vraie clé

La clé secrète dans un fichier commité = compromise dès le premier `git push`. GitHub **bloque** même le push. Correct : `.env` dans le `.gitignore`, et **seulement** des placeholders cassés (`sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>`) dans le code/support.

### PIÈGE #4 — Tester avec une vraie carte

En développement, on reste en **mode test** avec les **cartes de test** Stripe (`4242 4242 4242 4242`). Utiliser une vraie carte en dev, c'est du vrai argent — et de toute façon inutile puisque test et live sont cloisonnés.

### PIÈGE #5 — Croire que « Product » = « ce que paie le client »

Côté Stripe, le **Product** (« Premium ») est *ce qu'on vend*, mais le **montant** vit dans un objet **Price** séparé (4,90 €/mois). Un même Product peut avoir plusieurs Prices (mensuel/annuel). Le client s'abonne à un **Price**, pas à un Product. (Détaillé au module 01.)

### PIÈGE #6 — Ne pas épingler la version d'API

Sans `apiVersion` explicite, une évolution de l'API Stripe peut changer le comportement ou les types TS sans prévenir. Épingler (`apiVersion: '2026-06-24.dahlia'`) rend le comportement reproductible.

---

## 5. Ancrage TribuZen

Ce module est la **pierre de fondation** de la couche billing de TribuZen. Concrètement :

- Le modèle économique retenu est **freemium → abonnement** : plan gratuit conservé, **TribuZen Premium** (4,90 €/mois) débloque le partage illimité de tâches et le calendrier familial avancé. L'usage-based (offre B2B) est repoussé.
- Le module NestJS `StripeModule` (Exemple 1) sera **le point d'entrée unique** vers Stripe pour tout le reste du cours : Products/Prices (01), Checkout (02), webhooks (03), abonnements (04), portail (05), gates freemium (06).
- La clé secrète de test vit dans `.env` git-ignoré ; **aucune vraie clé** n'entre jamais dans le repo `smaurier/tribuzen`.

Arborescence cible dans `smaurier/tribuzen` :

```
tribuzen/
  .env                       ← STRIPE_SECRET_KEY (git-ignoré)
  .gitignore                 ← .env, node_modules, dist
  src/
    stripe/
      stripe.module.ts       ← provider STRIPE_CLIENT (Exemple 1)
    billing/
      billing.service.ts     ← injecte STRIPE_CLIENT, 1er appel balance.retrieve()
```

> Les modules suivants ajoutent des méthodes à `BillingService` (créer Product/Price, ouvrir une Checkout Session, traiter les webhooks). L'injection du client Stripe posée ici ne change plus.

---

## 6. Points clés

1. Facturer, c'est gérer un **cycle de vie** (abonné → paie → carte expire → annule) synchronisé entre Stripe, la BDD et l'UX — pas juste un bouton.
2. Trois modèles SaaS : **freemium**, **abonnement**, **usage-based** ; TribuZen fait freemium → abonnement.
3. Quatre briques Stripe : **Payments** (moteur), **Billing** (abonnements), **Checkout** (page de paiement hébergée), **Customer Portal** (espace client hébergé).
4. **Checkout** et **Portal** sont hébergés par Stripe → on ne code jamais le formulaire de carte → conformité PCI simplifiée.
5. **Test vs live** : deux environnements cloisonnés, clés distinctes ; on développe en test avec des cartes de test.
6. Préfixes : `pk_` (front, exposable), `sk_` (back, tous droits, secret), `rk_` (restreinte). Côté NestJS : `sk_test_…`.
7. La clé secrète vit dans `.env` **git-ignoré** ; support/code ne montrent que des **placeholders cassés**.
8. Dans NestJS, on expose Stripe comme **provider injectable** (`STRIPE_CLIENT`) via une factory + `ConfigService`, avec `apiVersion` épinglée.
9. Premier appel de vérification : `balance.retrieve()` — ne crée rien, prouve que la clé et le câblage sont bons.

---

## 7. Seeds Anki

```
Pourquoi ne jamais coder soi-même le formulaire de carte bancaire ?|Manipuler un numéro de carte impose la conformité PCI-DSS (lourde/risquée). On redirige vers Stripe Checkout (page hébergée) : la carte ne touche jamais nos serveurs.
Quels sont les 3 modèles économiques SaaS ?|Freemium (gratuit + options payantes), abonnement (récurrent, MRR), usage-based/metered (paiement à la consommation). TribuZen = freemium → abonnement.
À quoi servent Stripe Checkout et Customer Portal ?|Ce sont des pages hébergées par Stripe : Checkout encaisse le paiement (formulaire carte côté Stripe), Customer Portal laisse le client gérer seul son abonnement. Aucun écran de carte à coder.
Quelle est la différence entre mode test et mode live chez Stripe ?|Deux environnements totalement cloisonnés avec des clés distinctes. En test aucun argent réel ne circule (cartes de test type 4242...) ; en live, vrais paiements. On développe uniquement en test.
Que signifient les préfixes pk_, sk_ et rk_ ?|pk_ = clé publishable (front, exposable). sk_ = clé secrète (back, tous les droits, jamais exposée). rk_ = clé restreinte (permissions limitées). En test : suffixe _test_.
Où doit vivre la clé secrète Stripe et pourquoi ?|Dans un fichier .env git-ignoré (ou un secrets manager), jamais dans le code ni commitée. Elle a tous les droits ; GitHub bloque même le push d'une vraie clé. On ne montre que des placeholders cassés.
Comment configure-t-on Stripe dans NestJS ?|Comme provider injectable : une factory lit STRIPE_SECRET_KEY via ConfigService et retourne new Stripe(key, { apiVersion }). On exporte le token STRIPE_CLIENT et on l'injecte avec @Inject.
Pourquoi épingler apiVersion dans le SDK Stripe ?|Stripe versionne son API par date (ex. 2026-06-24, release dahlia). Épingler garantit un comportement et des types TS stables quand Stripe évolue. Le SDK Node typé attend la chaîne complète avec le nom de release : '2026-06-24.dahlia'.
Quel premier appel API pour vérifier la connexion Stripe ?|balance.retrieve() : il ne crée rien, il lit le solde. Une réponse valide prouve que la clé est bonne et le SDK bien câblé ; une erreur d'auth signale une clé invalide.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-00-introduction-au-billing-saas/README.md`. Configurer Stripe en mode test dans un projet NestJS et réussir un premier appel API — vrai SDK `stripe`, clé de test dans `.env` git-ignoré, corrigé commenté intégral.
