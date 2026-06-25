# Module 01 — Modèles de facturation & Stripe Products

| Difficulté | Durée estimée |
|------------|---------------|
| 2/5        | 45 min        |

> **Prérequis** : NestJS. Comprendre les modules NestJS avant d'intégrer Stripe.

## Objectifs

- Comprendre les 3 modèles de facturation Stripe
- Créer Products et Prices dans le dashboard Stripe
- Configurer le SDK Stripe dans NestJS
- Comprendre les entités clés : Customer, Subscription, Invoice

---

## Les 3 modèles de facturation

```
ONE-TIME (paiement unique)
  → Livre physique TribuZen : 25€ une fois
  → Stripe Product type = 'good'
  → Stripe Price type = 'one_time'

SUBSCRIPTION (abonnement récurrent)
  → TribuZen Premium : 4,90€/mois ou 49€/an
  → Stripe Product type = 'service'
  → Stripe Price type = 'recurring'
  → + interval (month | year)

USAGE-BASED (facturation à l'usage)
  → API TribuZen B2B : par appel
  → Stripe Price type = 'recurring'
  → + billing_scheme = 'tiered'
  → Complexe — pas pour le MVP TribuZen
```

---

## Créer les Products TribuZen dans Stripe Dashboard

```
Products → + Add product

Product 1 : TribuZen Premium
  Name : TribuZen Premium
  Description : App complète de réduction de charge mentale parentale
  Prices :
    - 4,90€/mois (recurring, monthly)
    - 49€/an (recurring, yearly)  ← afficher en premier (anchoring)

Product 2 : TribuZen Famille
  Prices :
    - 7,90€/mois
    - 79€/an

Product 3 : Livre Famille Annuel
  Type : One-time
  Price : 25€
```

---

## Configurer Stripe dans NestJS

```bash
npm install stripe
```

```typescript
// src/stripe/stripe.module.ts
import { Module } from '@nestjs/common';
import Stripe from 'stripe';

@Module({
  providers: [
    {
      provide: 'STRIPE_CLIENT',
      useFactory: (configService: ConfigService) =>
        new Stripe(configService.get('STRIPE_SECRET_KEY'), {
          apiVersion: '2024-04-10',
          typescript: true,
        }),
      inject: [ConfigService],
    },
  ],
  exports: ['STRIPE_CLIENT'],
})
export class StripeModule {}
```

```bash
# .env
STRIPE_SECRET_KEY=sk_live_...       # Production
STRIPE_SECRET_KEY=sk_test_...       # Test (utiliser en dev)
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PREMIUM_MONTHLY=price_xxx
STRIPE_PRICE_PREMIUM_YEARLY=price_yyy
STRIPE_PRICE_FAMILLE_MONTHLY=price_zzz
STRIPE_PRICE_FAMILLE_YEARLY=price_aaa
```

---

## Entités clés Stripe

```
Customer
  → Un utilisateur TribuZen = un Customer Stripe
  → Stocker stripe_customer_id dans la table users
  → Créer à l'inscription (ou à la première tentative de paiement)

Product
  → Ce qu'on vend (TribuZen Premium)
  → Immuable — modifier ne crée pas une nouvelle version

Price
  → Le tarif associé à un Product (4,90€/mois)
  → Archiver une Price quand elle change (ne pas supprimer)
  → Stocker les Price IDs en ENV (pas en dur dans le code)

Subscription
  → La relation entre un Customer et un Price
  → status : active | trialing | past_due | canceled | unpaid
  → Stocker subscription_id et status dans la table users

Invoice
  → Chaque paiement récurrent = une Invoice
  → Stripe envoie des emails de facture automatiquement
```

---

## Créer un Customer à l'inscription

```typescript
// src/users/users.service.ts
@Injectable()
export class UsersService {
  constructor(
    @Inject('STRIPE_CLIENT') private stripe: Stripe,
    private usersRepository: UsersRepository,
  ) {}

  async createUser(email: string, name: string): Promise<User> {
    // Créer le Customer Stripe en même temps que l'utilisateur
    const stripeCustomer = await this.stripe.customers.create({
      email,
      name,
      metadata: { platform: 'tribuzen' },
    });

    return this.usersRepository.create({
      email,
      name,
      stripeCustomerId: stripeCustomer.id,
      tier: 'free',
    });
  }
}
```

---

## Checklist

- [ ] Je comprends les 3 modèles de facturation (one-time, subscription, usage)
- [ ] Les Products et Prices TribuZen sont créés dans le dashboard Stripe
- [ ] Le SDK Stripe est configuré comme module NestJS injectable
- [ ] Un Customer Stripe est créé à chaque inscription utilisateur
- [ ] Les Price IDs sont en variables d'environnement (jamais en dur)
