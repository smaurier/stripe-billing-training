# Module 03 — Webhooks Stripe dans NestJS

| Difficulté | Durée estimée |
|------------|---------------|
| 4/5        | 75 min        |

> **Prérequis** : Modules 01-02 (Products + Checkout).

## Objectifs

- Comprendre pourquoi les webhooks sont critiques (pas l'API Stripe seule)
- Vérifier la signature webhook (sécurité indispensable)
- Gérer les événements clés : subscription, trial, payment
- Rendre les webhooks idempotents

---

## Pourquoi les webhooks sont indispensables

```
❌ Mauvaise approche : vérifier le paiement dans le success_url
  → success_url peut être appelé même si le paiement échoue
  → L'utilisateur peut manipuler l'URL
  → Pas de notification si paiement échoue après la session

✅ Bonne approche : webhook
  → Stripe appelle ton serveur quand un événement se produit
  → Signature cryptographique = impossible à falsifier
  → Fonctionne même si l'utilisateur ferme le navigateur
  → Idempotent = appelable plusieurs fois sans effet de bord
```

---

## Événements essentiels TribuZen

```
checkout.session.completed
  → Checkout réussi → activer le trial (ou le premium si pas de trial)

customer.subscription.created
  → Abonnement créé → démarrer le trial

customer.subscription.trial_will_end
  → 3 jours avant fin du trial → envoyer email "votre trial expire bientôt"

customer.subscription.updated
  → Changement de plan ou renouvellement

customer.subscription.deleted
  → Annulation → passer l'utilisateur en "free" à la fin de la période

invoice.payment_succeeded
  → Paiement réussi → étendre la période premium

invoice.payment_failed
  → Paiement échoué → email relance, passer en "past_due"
```

---

## Configuration du controller webhook

```typescript
// src/stripe/stripe-webhook.controller.ts
import {
  Controller, Post, Headers, RawBodyRequest, Req, HttpCode, BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import Stripe from 'stripe';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(
    @Inject('STRIPE_CLIENT') private stripe: Stripe,
    private stripeWebhookService: StripeWebhookService,
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) throw new BadRequestException('Missing stripe-signature header');

    let event: Stripe.Event;
    try {
      // Vérification cryptographique — JAMAIS sauter cette étape
      event = this.stripe.webhooks.constructEvent(
        req.rawBody,  // Corps brut (pas JSON parsé — important !)
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      throw new BadRequestException(`Webhook signature verification failed: ${err.message}`);
    }

    await this.stripeWebhookService.handleEvent(event);
    return { received: true };
  }
}
```

**Important : rawBody dans main.ts**
```typescript
// main.ts
const app = await NestFactory.create(AppModule, {
  rawBody: true, // Nécessaire pour la vérification webhook Stripe
});
```

---

## Handler des événements

```typescript
// src/stripe/stripe-webhook.service.ts
@Injectable()
export class StripeWebhookService {
  constructor(private usersService: UsersService) {}

  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.trial_will_end':
        await this.handleTrialEnding(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      // Ignorer les événements non gérés — NE PAS throw
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  }

  private async handleSubscriptionUpdate(subscription: Stripe.Subscription): Promise<void> {
    const customerId = subscription.customer as string;
    const user = await this.usersService.findByStripeCustomerId(customerId);
    if (!user) return; // Idempotence : pas d'erreur si l'utilisateur n'existe plus

    const tier = this.getTierFromSubscription(subscription);

    await this.usersService.updateSubscription(user.id, {
      stripeSubscriptionId: subscription.id,
      tier,
      subscriptionStatus: subscription.status,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null,
    });
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const customerId = subscription.customer as string;
    const user = await this.usersService.findByStripeCustomerId(customerId);
    if (!user) return;

    // Passer en free à la fin de la période payée (pas immédiatement)
    await this.usersService.scheduleDowngrade(user.id, {
      tier: 'free',
      downgradeAt: new Date(subscription.current_period_end * 1000),
    });
  }

  private getTierFromSubscription(subscription: Stripe.Subscription): 'free' | 'premium' | 'family' {
    if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
      return 'free';
    }
    const priceId = subscription.items.data[0]?.price.id;
    const familyPrices = [
      process.env.STRIPE_PRICE_FAMILLE_MONTHLY,
      process.env.STRIPE_PRICE_FAMILLE_YEARLY,
    ];
    return familyPrices.includes(priceId) ? 'family' : 'premium';
  }
}
```

---

## Tester les webhooks en local

```bash
# Installer la CLI Stripe
npm install -g @stripe/stripe-cli

# Forwarder les webhooks vers ton serveur local
stripe login
stripe listen --forward-to localhost:3000/webhooks/stripe

# Dans un autre terminal, déclencher des événements
stripe trigger checkout.session.completed
stripe trigger customer.subscription.trial_will_end
```

---

## Idempotence : traiter deux fois sans effet de bord

```typescript
// Stripe peut envoyer le même webhook plusieurs fois (retry en cas d'échec réseau)
// L'idempotence = appeler le handler 2x donne le même résultat que 1x

// ✅ Utiliser event.id pour détecter les duplicats
async handleEvent(event: Stripe.Event): Promise<void> {
  const alreadyProcessed = await this.redis.get(`webhook:${event.id}`);
  if (alreadyProcessed) {
    console.log(`Event ${event.id} already processed, skipping`);
    return;
  }

  await this.processEvent(event);

  // Marquer comme traité (TTL 7 jours)
  await this.redis.set(`webhook:${event.id}`, '1', 'EX', 7 * 24 * 60 * 60);
}
```

---

## Checklist

- [ ] rawBody activé dans main.ts
- [ ] Signature webhook vérifiée avec `constructEvent` avant tout traitement
- [ ] Tous les événements clés gérés (subscription created/updated/deleted/trial)
- [ ] Les événements inconnus sont ignorés (pas de throw)
- [ ] Idempotence implémentée via Redis + event.id
- [ ] `stripe listen --forward-to` utilisé en développement local
