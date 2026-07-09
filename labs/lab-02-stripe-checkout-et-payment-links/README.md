# Lab 02 — Checkout Session d'upgrade TribuZen Premium

> **Outcome :** à la fin, tu sais créer un endpoint NestJS qui génère une **Checkout Session Stripe** (`mode: 'subscription'`) pour l'upgrade vers TribuZen Premium, et le tester bout en bout avec la carte `4242 4242 4242 4242`.
> **Vrai outil :** SDK `stripe` (Node) en **mode test** + NestJS + le dashboard Stripe (test mode). Aucun harnais simulé — tu appelles la vraie API Stripe test.
> **Feedback :** le coach valide en session (redirection réelle vers la page hébergée + paiement test qui aboutit). Pas de test-runner auto-correcteur.

---

## Prérequis

- Un compte Stripe (gratuit) en **mode test**.
- Les **clés de test** dans un fichier `.env` **jamais commité** (voir `.gitignore`) :

```bash
# .env  (NE JAMAIS COMMITER — placeholders ci-dessous, remplace par TES clés de test)
STRIPE_SECRET_KEY=sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>
STRIPE_PRICE_PREMIUM_MONTHLY=price_<TON-PRICE-PREMIUM-MENSUEL-DE-TEST>
APP_URL=http://localhost:3000
```

- Un **Product « TribuZen Premium »** avec un **Price récurrent mensuel** créé dans le dashboard Stripe (test mode) — c'est le livrable du lab 01. Récupère son ID (`price_...`) et mets-le dans `.env`.

---

## Énoncé

Tu construis l'endpoint qui déclenche l'upgrade Premium. Cahier des charges **exact** :

1. Une route `POST /billing/checkout`.
2. Elle crée une **Checkout Session** Stripe en `mode: 'subscription'`.
3. Elle facture le Price Premium mensuel (`STRIPE_PRICE_PREMIUM_MONTHLY`), quantité 1.
4. Elle attache `client_reference_id` (un ID utilisateur, ici en dur pour le lab, ex. `'user_demo'`) et un `metadata` `{ plan: 'premium' }`.
5. `success_url` = `${APP_URL}/premium/merci?session_id={CHECKOUT_SESSION_ID}` et `cancel_url` = `${APP_URL}/premium`.
6. La route renvoie `{ url }` (l'URL hébergée Stripe).
7. Tu appelles la route, tu ouvres l'`url` renvoyée, tu paies avec `4242 4242 4242 4242` et tu vérifies dans le dashboard Stripe (test mode) que l'abonnement apparaît.

**Pas de gap-fill** — tu écris le service et le contrôleur à partir du starter minimal.

### Starter minimal

```ts
// src/stripe/stripe.module.ts — provider du client Stripe (rappel module 01)
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'STRIPE_CLIENT',
      useFactory: (config: ConfigService) =>
        new Stripe(config.get<string>('STRIPE_SECRET_KEY')),
      inject: [ConfigService],
    },
  ],
  exports: ['STRIPE_CLIENT'],
})
export class StripeModule {}
```

```ts
// src/billing/billing.service.ts — À COMPLÉTER
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class BillingService {
  constructor(
    @Inject('STRIPE_CLIENT') private readonly stripe: Stripe,
    private readonly config: ConfigService,
  ) {}

  // À toi : créer la Checkout Session subscription et renvoyer session.url
  async createPremiumCheckout(userId: string): Promise<string> {
    // ...
    return '';
  }
}
```

```ts
// src/billing/billing.controller.ts — À COMPLÉTER
import { Controller, Post } from '@nestjs/common';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // À toi : POST /billing/checkout → { url }
}
```

---

## Étapes (en friction)

1. **Provider Stripe** — branche `StripeModule` dans ton `AppModule`, vérifie que `ConfigModule.forRoot()` charge le `.env`.
2. **Écris `createPremiumCheckout`** — appelle `this.stripe.checkout.sessions.create({...})` avec `mode: 'subscription'`, `line_items` référençant `STRIPE_PRICE_PREMIUM_MONTHLY`, `client_reference_id`, `metadata`, `success_url`, `cancel_url`. Retourne `session.url`.
3. **Écris le contrôleur** — `POST /billing/checkout` appelle le service avec un `userId` de démo (`'user_demo'`) et renvoie `{ url }`.
4. **Lance l'app** (`npm run start:dev`) et appelle la route :
   ```bash
   curl -X POST http://localhost:3000/billing/checkout
   ```
5. **Ouvre l'`url`** renvoyée dans le navigateur → tu dois voir la page de paiement hébergée Stripe pour « TribuZen Premium ».
6. **Paie en test** avec `4242 4242 4242 4242`, date future, CVC quelconque.
7. **Vérifie** dans le dashboard Stripe (test mode) → *Customers* / *Subscriptions* : un abonnement `active` (ou `trialing`) doit apparaître.
8. **Cas d'erreur volontaire** : mets `mode: 'payment'` avec ton Price récurrent → observe l'erreur Stripe, puis remets `subscription`. Tu ancres ainsi le couple `mode`/type de Price.

---

## Corrigé complet commenté

```ts
// src/billing/billing.service.ts — corrigé
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class BillingService {
  constructor(
    @Inject('STRIPE_CLIENT') private readonly stripe: Stripe,
    private readonly config: ConfigService,
  ) {}

  async createPremiumCheckout(userId: string): Promise<string> {
    // APP_URL vient du .env (http://localhost:3000 en dev)
    const appUrl = this.config.get<string>('APP_URL');

    const session = await this.stripe.checkout.sessions.create({
      // Abonnement récurrent → mode subscription.
      // Un Price recurring EXIGE ce mode (sinon Stripe renvoie une erreur).
      mode: 'subscription',

      // On facture le Price Premium mensuel, référencé par son ID (jamais en dur).
      // L'ID vient du .env → une seule source de vérité pour le tarif.
      line_items: [
        { price: this.config.get<string>('STRIPE_PRICE_PREMIUM_MONTHLY'), quantity: 1 },
      ],

      // Clés de réconciliation : le webhook checkout.session.completed (module 03)
      // les relira pour savoir QUI a payé et quoi appliquer.
      client_reference_id: userId,        // ici 'user_demo' — en vrai : user.id
      metadata: { plan: 'premium' },      // contexte libre

      // Retours. {CHECKOUT_SESSION_ID} est remplacé par Stripe à la redirection.
      // ⚠️ success_url = UX seulement, PAS une preuve de paiement (voir module 03).
      success_url: `${appUrl}/premium/merci?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/premium`,
    });

    // session.url = page de paiement hébergée par Stripe → le front y redirige.
    return session.url;
  }
}
```

```ts
// src/billing/billing.controller.ts — corrigé
import { Controller, Post } from '@nestjs/common';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('checkout')
  async createCheckout(): Promise<{ url: string }> {
    // userId en dur pour le lab. En vrai : @UseGuards(JwtAuthGuard) + @CurrentUser().
    const url = await this.billing.createPremiumCheckout('user_demo');
    return { url }; // le front ferait window.location.href = url
  }
}
```

**Pourquoi ce corrigé est correct :**
- `mode: 'subscription'` matche le Price récurrent → pas d'erreur Stripe.
- `line_items` référence le Price **par ID** (`.env`), pas de montant en dur : un seul endroit pour changer le tarif.
- `client_reference_id` + `metadata` sont posés **dès la création** : sans eux, le webhook du module 03 recevrait un paiement anonyme.
- `success_url` sert la page « merci » mais ne débloque **rien** — la sécurité viendra du webhook signé (module 03).
- La création est **côté serveur** : la clé `sk_test_...` ne quitte jamais le backend ; le front ne reçoit que `url`.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé ni le module 02, en 25 minutes :**

1. Ajoute une seconde route `POST /billing/checkout/livre` qui crée une Checkout Session en **`mode: 'payment'`** pour le **livre annuel** (un Price `one_time` — crée-le au besoin dans le dashboard, ID en `.env` sous `STRIPE_PRICE_LIVRE_ANNUEL`).
2. Factorise la logique commune : une seule méthode privée qui prend `(mode, priceEnvKey, userId, metadata)` et construit la session, appelée par les deux routes.
3. Teste les **deux** flux avec `4242 4242 4242 4242` et vérifie dans le dashboard : un **abonnement** pour Premium, un **paiement unique** pour le livre.

**Critère de réussite :** les deux routes fonctionnent, le bon `mode` va avec le bon type de Price, et le code du service n'est pas dupliqué.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, cet endpoint vit ici :

```
tribuzen/
  src/
    billing/
      billing.controller.ts   ← POST /billing/checkout (guardé JWT)
      billing.service.ts       ← createPremiumCheckout
```

**Différences par rapport au lab :**

- Le contrôleur sera protégé par `@UseGuards(JwtAuthGuard)` et le `userId` viendra de `@CurrentUser()` — pas de `'user_demo'` en dur.
- On passera aussi `customer: user.stripeCustomerId` (le Customer Stripe créé à l'inscription, module 01) pour relier durablement l'abonnement à l'identité Stripe.
- Le déblocage réel de `tier: 'premium'` se fera **au module 03** via le webhook `checkout.session.completed`, jamais sur le `success_url`.

**Commit cible :**
```
feat(billing): endpoint POST /billing/checkout — Checkout Session subscription Premium
```
