# Lab 00 — Configurer Stripe en mode test dans NestJS + premier appel API

> **Outcome :** à la fin, tu sais brancher le SDK Stripe (mode test) dans un projet NestJS, garder la clé secrète hors du repo, et confirmer la connexion par un vrai appel API qui répond.
> **Vrai outil :** NestJS + le paquet npm officiel `stripe` + un compte Stripe réel en **mode test** (aucun paiement réel). JAMAIS un harnais simulé.
> **Feedback :** le coach valide en session (pas de test-runner auto-correcteur).

---

## Énoncé

Tu démarres la couche billing de **TribuZen**. Avant tout paiement, tu dois prouver que ton NestJS parle à Stripe **proprement et sans fuite de clé**.

Tâche : dans un projet NestJS (neuf ou existant), configure le SDK `stripe` en **mode test** via un provider injectable, puis fais un **premier appel API** (`balance.retrieve()`) qui répond sans erreur au démarrage.

**Contraintes non négociables (sécurité) :**

- La clé secrète vit **uniquement** dans un fichier `.env` **git-ignoré**.
- Aucune vraie clé n'apparaît dans un fichier commité. Dans ce README et tout exemple, on n'écrit que le **placeholder cassé** `sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>`.
- Tu récupères ta vraie clé de test (`sk_test_…`) dans **ton** dashboard Stripe (Developers → API keys, en mode test) et tu la colles dans **ton** `.env` local — jamais ici.

**Prérequis d'outillage :**

- Un compte Stripe (gratuit) — dashboard basculé en **mode test** (interrupteur en haut à droite).
- Node + un projet NestJS. Si tu pars de zéro : `npm i -g @nestjs/cli && nest new tribuzen-billing`.
- (Optionnel mais recommandé) la **Stripe CLI** pour inspecter : `stripe login` puis `stripe balance retrieve` doit répondre en mode test.

### Starter minimal

```bash
npm install stripe @nestjs/config
```

```gitignore
# .gitignore — vérifie que .env y est AVANT de committer quoi que ce soit
.env
node_modules
dist
```

```bash
# .env — NON commité. Remplace le placeholder par TA clé de test locale.
STRIPE_SECRET_KEY=sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>
```

```typescript
// src/stripe/stripe.module.ts — starter à compléter
import { Module } from '@nestjs/common';
// TODO: importer ConfigModule/ConfigService et Stripe
// TODO: exporter un token STRIPE_CLIENT + une factory qui lit STRIPE_SECRET_KEY
```

Pas de gap-fill : tu écris le module et le service complets à partir de ce squelette.

---

## Étapes (en friction)

1. **Vérifie le `.gitignore`** en premier : `.env` doit y figurer. Fais `git status` et confirme que `.env` n'apparaît **pas** dans les fichiers suivis.
2. **Récupère ta clé de test** dans le dashboard Stripe (mode test) et colle-la dans `.env` (localement, jamais committé).
3. **Écris `StripeModule`** : un provider avec token `STRIPE_CLIENT`, une factory qui lit `STRIPE_SECRET_KEY` via `ConfigService`, instancie `new Stripe(key, { apiVersion: '2026-06-24.dahlia' })`, et **throw** si la clé manque (fail fast).
4. **Charge la config** globalement dans `AppModule` (`ConfigModule.forRoot({ isGlobal: true })`) et importe `StripeModule`.
5. **Écris `BillingService`** qui injecte `STRIPE_CLIENT` et appelle `balance.retrieve()` dans `onModuleInit()`, avec un log de succès et un log d'erreur explicite.
6. **Lance** `npm run start:dev` et observe le log `Stripe connecté …`.
7. **Teste le fail fast** : renomme temporairement la variable dans `.env` → l'app doit crasher au démarrage avec un message clair. Remets ensuite la bonne clé.
8. **Contrôle sécurité final** : `git diff --staged` ne doit contenir **aucune** chaîne `sk_test_` suivie de vrais caractères. Seul le placeholder cassé est autorisé dans les fichiers versionnés.

---

## Corrigé complet commenté

```typescript
// src/stripe/stripe.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

// Token d'injection exporté : les autres modules injectent Stripe via ce token
export const STRIPE_CLIENT = 'STRIPE_CLIENT';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STRIPE_CLIENT,
      // Factory : NestJS l'appelle une fois et met en cache l'instance Stripe
      useFactory: (config: ConfigService) => {
        const key = config.get<string>('STRIPE_SECRET_KEY');
        if (!key) {
          // Fail fast : crash au démarrage plutôt qu'à la 1re requête paiement
          throw new Error('STRIPE_SECRET_KEY manquante dans .env');
        }
        return new Stripe(key, {
          // Version d'API épinglée => comportement + types TS stables
          apiVersion: '2026-06-24.dahlia',
        });
      },
      inject: [ConfigService], // ConfigService passé en argument de la factory
    },
  ],
  exports: [STRIPE_CLIENT], // rendu disponible aux modules qui importent StripeModule
})
export class StripeModule {}
```

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StripeModule } from './stripe/stripe.module';
import { BillingService } from './billing/billing.service';

@Module({
  imports: [
    // isGlobal : ConfigService dispo partout, .env chargé automatiquement
    ConfigModule.forRoot({ isGlobal: true }),
    StripeModule,
  ],
  providers: [BillingService],
})
export class AppModule {}
```

```typescript
// src/billing/billing.service.ts
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Stripe from 'stripe';
import { STRIPE_CLIENT } from '../stripe/stripe.module';

@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);

  // @Inject par token : le provider STRIPE_CLIENT fournit l'instance Stripe
  constructor(@Inject(STRIPE_CLIENT) private readonly stripe: Stripe) {}

  // OnModuleInit : exécuté une fois quand le module est initialisé
  async onModuleInit(): Promise<void> {
    try {
      // Premier appel : lit le solde, ne crée rien. Prouve que la clé est valide.
      const balance = await this.stripe.balance.retrieve();
      this.logger.log(
        `Stripe connecté (devise: ${balance.available[0]?.currency ?? 'n/a'})`,
      );
    } catch (err) {
      // Clé invalide/absente => Stripe renvoie une erreur d'authentification
      this.logger.error('Connexion Stripe échouée — vérifie STRIPE_SECRET_KEY');
      throw err; // on relance : mieux vaut ne pas démarrer qu'un billing cassé
    }
  }
}
```

**Pourquoi ce corrigé est correct :**

- La clé n'est **jamais** en dur : elle est lue depuis `.env` (git-ignoré) via `ConfigService`. Le code versionné ne contient aucun secret.
- Le **fail fast** (throw si clé absente) transforme un bug silencieux en crash immédiat et lisible au démarrage.
- `balance.retrieve()` est **idempotent et non destructif** — parfait pour un check de connexion : aucune donnée créée, aucun paiement.
- `apiVersion` épinglée évite qu'une évolution de l'API Stripe change le comportement sous tes pieds.
- Le token `STRIPE_CLIENT` exporté sera réutilisé tel quel par tous les modules suivants (Products/Prices, Checkout, webhooks).

### Vérifier avec la Stripe CLI (optionnel)

```bash
stripe login            # ouvre le navigateur, associe la CLI à ton compte
stripe balance retrieve # doit répondre un objet balance en mode test
```

Si la CLI répond, ta clé de test et ton compte sont bons — indépendamment de ton code NestJS.

---

## Grille de validation

| Critère | Attendu | OK ? |
|---------|---------|------|
| `.env` git-ignoré | `git status` ne liste jamais `.env` ; `.env` est dans `.gitignore` | ☐ |
| Zéro secret versionné | `git diff --staged` ne contient aucune vraie `sk_test_…` (placeholder cassé uniquement) | ☐ |
| Provider injectable | `STRIPE_CLIENT` fourni par factory + exporté par `StripeModule` | ☐ |
| Clé lue via ConfigService | Aucune clé en dur dans le code | ☐ |
| Fail fast | App crashe au démarrage avec message clair si la clé manque | ☐ |
| apiVersion épinglée | `apiVersion: '2026-06-24.dahlia'` (chaîne complète avec release, exigée par le type SDK) | ☐ |
| Premier appel réussi | Log `Stripe connecté …` au `start:dev` | ☐ |
| Mode test confirmé | Clé `sk_test_` + dashboard en mode test | ☐ |

---

## Coach — points à challenger en session

> Le coach ne corrige pas du code fourni : il vérifie l'autonomie et la compréhension. Au moins 3 questions.

1. **« Montre-moi que ta clé n'est pas dans le repo. »** — L'apprenant doit ouvrir `.gitignore`, faire `git status` et `git log -p` sur les fichiers de config pour prouver qu'aucun secret n'a fuité. S'il hésite, creuser : que se passe-t-il si `.env` avait déjà été commité une fois ?
2. **« Pourquoi `balance.retrieve()` et pas `customers.create()` pour tester ? »** — Attendu : `retrieve` ne crée rien (non destructif, idempotent) ; `create` polluerait le compte de test à chaque démarrage.
3. **« Coupe la clé et relance. Que doit-il se passer, et pourquoi c'est mieux ? »** — Attendu : crash au démarrage (fail fast) plutôt qu'une erreur au premier paiement client en prod.
4. **« Quelle brique Stripe encaissera réellement le paiement, et pourquoi tu ne codes pas le formulaire de carte ? »** — Attendu : Checkout (page hébergée) ; conformité PCI.
5. **« Où mettrais-tu cette clé en production, et pas dans un `.env` ? »** — Attendu : secrets manager / variables d'environnement du PaaS ; éventuellement clé restreinte `rk_`.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées :**

Reproduis la configuration **de mémoire, en 20 minutes**, sans rouvrir ce corrigé ni le module 00, avec ces changements :

1. Ajoute une variable `STRIPE_API_VERSION` dans `.env` et lis-la via `ConfigService` (au lieu de coder la version en dur dans la factory).
2. Remplace le check `balance.retrieve()` par un endpoint HTTP `GET /billing/health` (contrôleur NestJS) qui renvoie `{ stripe: 'ok' }` si l'appel réussit, `503` sinon.
3. Vérifie **avant tout commit** qu'aucune vraie clé n'est versionnée (`git diff --staged`).

**Critère de réussite :** `GET /billing/health` répond `200 { stripe: 'ok' }` en mode test, la version d'API vient de `.env`, et le repo ne contient aucun secret.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, cette fondation vit ici :

```
tribuzen/
  .env                       ← STRIPE_SECRET_KEY (git-ignoré)
  .gitignore                 ← .env, node_modules, dist
  src/
    stripe/
      stripe.module.ts       ← provider STRIPE_CLIENT
    billing/
      billing.service.ts     ← injecte STRIPE_CLIENT, 1er appel balance.retrieve()
```

**Différences par rapport au lab :**

- En production, `STRIPE_SECRET_KEY` viendra d'un **secrets manager** (pas d'un `.env`), et on passera d'une clé `sk_test_` à une clé `sk_live_` (ou mieux, une clé restreinte `rk_live_`) au moment du go-live (module 09).
- `BillingService` s'enrichira au fil du cours (créer Product/Price, ouvrir une Checkout Session, traiter les webhooks). L'injection du client Stripe posée ici ne changera plus.

**Commit cible :**

```
feat(billing): brancher le SDK Stripe en mode test (StripeModule + health check)
```
