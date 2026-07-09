# Lab 03 — Webhooks et idempotence

> **Outcome :** à la fin, tu sais construire un endpoint webhook NestJS **signé** (`constructEvent` sur le raw body) et **idempotent** (dédup via `event.id`), et le tester en local avec la Stripe CLI (`stripe listen`).
> **Vrai outil :** NestJS + SDK `stripe` (npm) en **mode test** + **Stripe CLI** (`stripe listen`, `stripe trigger`).
> **Feedback :** le coach valide en session — pas de test-runner auto-correcteur.
>
> **⚠️ Sécurité.** La vérification de signature est **obligatoire**. Aucune version « qui `JSON.parse` sans vérifier », même pour débloquer le lab. Toutes les clés/secrets sont des **placeholders** dans `.env` — jamais de vraie clé committée.

---

## Énoncé

Tu ajoutes le back-office billing de **TribuZen Premium**. Objectif : un endpoint `POST /webhooks/stripe` qui reçoit les events Stripe, **vérifie leur signature**, les **route**, et bascule l'utilisateur en Premium — le tout **idempotent**.

Cahier des charges **exact** :

1. Activer `rawBody: true` dans `main.ts`.
2. `POST /webhooks/stripe` : vérifier la signature avec `stripe.webhooks.constructEvent(rawBody, signature, secret)`.
3. Header `stripe-signature` absent → `400`. Signature invalide → `400`. Rien n'est traité dans ces cas.
4. Router au minimum : `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Tout autre type → **ignoré** (pas de throw).
5. Sur `customer.subscription.created/updated` avec `status` `trialing`/`active` → passer l'utilisateur en `premium`. Sur `deleted` → `free`.
6. **Idempotence** : dédupliquer via `event.id` (un `Set` en mémoire suffit pour le lab ; on note la vraie table Postgres en commentaire).
7. Tester avec la Stripe CLI : `stripe listen --forward-to localhost:3000/webhooks/stripe` puis `stripe trigger checkout.session.completed`.

**Pas de gap-fill** — tu écris controller + service à partir du starter.

### Prérequis d'environnement

```bash
npm install stripe
# Stripe CLI : https://docs.stripe.com/stripe-cli  (winget/scoop/brew selon l'OS)
stripe login
```

`.env` (jamais commité — placeholders cassés, à remplacer par tes vraies clés de test **en local seulement**) :

```
STRIPE_SECRET_KEY=sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>
STRIPE_WEBHOOK_SECRET=whsec_<SECRET-WEBHOOK-EXEMPLE>
```

> Le vrai `whsec_...` de dev est affiché par `stripe listen` au démarrage (`> Ready! Your webhook signing secret is whsec_...`). Colle-le dans ton `.env` local, ne le committe jamais.

### Starter minimal

```ts
// src/main.ts — starter
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // À toi : activer le raw body pour la vérification de signature
  });
  await app.listen(3000);
}
bootstrap();
```

```ts
// src/billing/stripe-webhook.controller.ts — starter
import { Controller, Post } from '@nestjs/common';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  // À toi : @Post() handle(...) avec vérification de signature + délégation au service
}
```

```ts
// src/billing/stripe-webhook.service.ts — starter
import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeWebhookService {
  // À toi : handleEvent(event) — idempotence via event.id + switch de routage
}
```

---

## Étapes (en friction)

1. **`main.ts`** — active `rawBody: true` dans `NestFactory.create`.
2. **Client Stripe** — expose un provider `STRIPE_CLIENT` (`new Stripe(process.env.STRIPE_SECRET_KEY!)`) injectable.
3. **Controller** — `@Post()`, récupère `@Req() req: RawBodyRequest<Request>` et `@Headers('stripe-signature')`. Header absent → `BadRequestException`.
4. **Vérification** — `constructEvent(req.rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!)` dans un `try/catch`. Catch → `400`. Aucune lecture de `event.data` avant.
5. **Service — idempotence d'abord** — `if (seen.has(event.id)) return;` en tête de `handleEvent`.
6. **Service — routage** — `switch (event.type)` avec les 5 cas + `default` qui **ignore**.
7. **Effet métier** — sur `subscription.created/updated` → `tier = trialing|active ? 'premium' : 'free'`. Marque `event.id` traité après succès.
8. **Tester** — un terminal : `stripe listen --forward-to localhost:3000/webhooks/stripe`. Un autre : `stripe trigger checkout.session.completed` puis `stripe trigger customer.subscription.updated`.
9. **Vérifier l'idempotence** — dans les logs de `stripe listen`, note l'`evt_...`. Rejoue-le : `stripe events resend evt_...`. Ton service doit logguer « déjà traité — ignoré » et ne rien refaire.
10. **Vérifier la sécurité** — envoie un POST forgé : `curl -X POST localhost:3000/webhooks/stripe -d '{}'`. Réponse attendue : `400` (header/signature manquants), aucun changement d'état.

---

## Corrigé complet commenté

```ts
// src/main.ts — corrigé
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // ← expose req.rawBody, indispensable pour constructEvent
  });
  await app.listen(3000);
}
bootstrap();
```

```ts
// src/billing/stripe.provider.ts — corrigé
import { Provider } from '@nestjs/common';
import Stripe from 'stripe';

// Provider injectable : un seul client Stripe pour toute l'app
export const StripeProvider: Provider = {
  provide: 'STRIPE_CLIENT',
  useFactory: () => new Stripe(process.env.STRIPE_SECRET_KEY!),
  // La version d'API par défaut du SDK convient ; on peut la figer si besoin.
};
```

```ts
// src/billing/stripe-webhook.controller.ts — corrigé
import {
  Controller, Post, Req, Headers, HttpCode,
  BadRequestException, Inject,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import Stripe from 'stripe';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(
    @Inject('STRIPE_CLIENT') private readonly stripe: Stripe,
    private readonly webhookService: StripeWebhookService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    // 1. Pas de header signature = requête suspecte → 400, on ne lit rien
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    // 2. Vérification cryptographique AVANT toute lecture du payload
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        req.rawBody as Buffer,               // corps BRUT (rawBody: true)
        signature,                            // header stripe-signature
        process.env.STRIPE_WEBHOOK_SECRET!,   // whsec_... depuis .env / stripe listen
      );
    } catch (err) {
      // Signature invalide → payload forgé ou mauvais secret → 400, rien de traité
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new BadRequestException(`Webhook signature verification failed: ${msg}`);
    }

    // 3. Event authentique et typé → on délègue le routage idempotent
    await this.webhookService.handleEvent(event);

    // 4. 2xx rapide → Stripe considère l'event livré
    return { received: true };
  }
}
```

```ts
// src/billing/stripe-webhook.service.ts — corrigé
import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  // Lab : dédup en mémoire. EN PROD : table Postgres
  // processed_webhook_events(event_id PK, processed_at) — survit aux redémarrages,
  // et idéalement marquée dans la MÊME transaction que la mise à jour métier.
  private readonly seen = new Set<string>();

  async handleEvent(event: Stripe.Event): Promise<void> {
    // --- Idempotence EN PREMIER : Stripe livre au moins une fois (retries) ---
    if (this.seen.has(event.id)) {
      this.logger.log(`Event ${event.id} déjà traité — ignoré`);
      return;
    }

    // --- Routage : ne traiter QUE ce qu'on comprend ---
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const customerId = session.customer as string | null;
        // metadata.userId posé à la création de la session (module 02)
        this.logger.log(`Checkout OK — user=${userId} customer=${customerId}`);
        // await this.users.attachStripeCustomer(userId, customerId);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        // Source de vérité du tier = statut de l'abonnement
        const isActive = sub.status === 'active' || sub.status === 'trialing';
        const tier = isActive ? 'premium' : 'free';
        this.logger.log(`Subscription ${sub.status} → tier=${tier} (customer=${sub.customer})`);
        // await this.users.updateSubscription(...) : subscriptionStatus + tier
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        this.logger.log(`Subscription supprimée → tier=free (customer=${sub.customer})`);
        // await this.users.updateSubscription(...) : tier='free'
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        // On ne coupe PAS Premium tout de suite : Stripe retente (dunning, module 07)
        this.logger.warn(`Paiement échoué → past_due (customer=${invoice.customer})`);
        // await this.users.markPastDue(...)
        break;
      }

      // Tout le reste : IGNORÉ (jamais de throw → pas de 5xx / retries inutiles)
      default:
        this.logger.debug(`Event non géré : ${event.type}`);
    }

    // --- Marquer traité APRÈS succès (en prod : même transaction que le métier) ---
    this.seen.add(event.id);
  }
}
```

**Pourquoi ce corrigé est correct :**
- **Signature avant tout** : `constructEvent` est la première chose faite, dans un `try/catch`. Aucun `event.data` n'est lu si la signature est invalide → l'endpoint public est verrouillé.
- **Raw body** : `rawBody: true` + `req.rawBody` passés tels quels. Pas de `express.json()` qui casserait les octets signés.
- **Idempotence en tête** : le check `event.id` est la première ligne de `handleEvent`, avant tout effet de bord. Un `resend` Stripe est ignoré proprement.
- **`default` qui ignore** : Stripe envoie des dizaines de types ; on ne throw jamais sur l'inconnu, sinon 5xx → retries en boucle.
- **Pas de JWT** : la route n'a pas de guard applicatif — la signature *est* l'authentification.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées :**

Reproduis l'endpoint **de mémoire, en 30 minutes**, avec en plus :

1. **Idempotence persistante** : remplace le `Set` en mémoire par une vraie table Postgres `processed_webhook_events(event_id PK, processed_at)`. Le check et le `INSERT` se font dans la **même transaction** que la mise à jour de l'utilisateur (si le commit échoue, l'event n'est ni traité ni marqué → Stripe retentera).
2. **Gérer `invoice.paid`** en plus (extension de période), en vérifiant le nom exact de l'event sur `docs.stripe.com` avant de l'ajouter.
3. **Sans rouvrir ce corrigé** ni le module 03.

**Critère de réussite :** `stripe trigger checkout.session.completed` bascule l'utilisateur en Premium ; `stripe events resend <evt_id>` ne rejoue rien (loggué « déjà traité ») ; un `curl` forgé renvoie `400`.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, le webhook billing vit ici :

```
tribuzen-api/
  src/
    main.ts                              ← rawBody: true
    billing/
      stripe.provider.ts                 ← client Stripe injectable
      stripe-webhook.controller.ts       ← signature + délégation
      stripe-webhook.service.ts          ← routage + idempotence
      processed-events.repo.ts           ← table processed_webhook_events (variante J+30)
```

**Différences par rapport au lab :**

- L'idempotence utilise la **table Postgres** (cours 10), pas un `Set` en mémoire — elle survit aux redéploiements et scale sur plusieurs instances.
- Les effets métier appellent le vrai `UsersService` (`attachStripeCustomer`, `updateSubscription`, `markPastDue`) au lieu de logguer.
- Le secret `whsec_...` de production vient du dashboard Stripe (endpoint enregistré), injecté par variable d'environnement du déploiement — **jamais** dans le repo.
- C'est ce webhook, et lui seul, qui active TribuZen Premium — **jamais** le retour navigateur (`success_url`).

**Commit cible :**
```
feat(billing): webhook Stripe signé + idempotent — active Premium sur customer.subscription.*
```
