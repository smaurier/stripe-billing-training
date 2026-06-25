# Module 02 — Stripe Checkout

| Difficulté | Durée estimée |
|------------|---------------|
| 3/5        | 60 min        |

## Objectifs
- Créer une session Checkout depuis NestJS
- Implémenter la page de succès et d'annulation
- Gérer les paramètres de trial depuis le Checkout
- Appliquer la psychologie du pricing (anchoring, loss aversion)

---

## Hosted vs Embedded

```
HOSTED (recommandé pour TribuZen MVP) :
  → Stripe gère la page de paiement
  → Zéro code frontend pour le formulaire de carte
  → PCI-compliant out of the box
  → Redirection vers stripe.com/pay/...

EMBEDDED :
  → Formulaire dans ton app (Stripe Elements)
  → Plus de contrôle sur l'UX
  → PCI SAQ A-EP → responsabilité accrue
  → Pour V2 si l'expérience de paiement est critique
```

---

## Créer une session Checkout (NestJS)

```typescript
// src/billing/billing.service.ts
@Injectable()
export class BillingService {
  constructor(@Inject('STRIPE_CLIENT') private stripe: Stripe) {}

  async createCheckoutSession(
    user: User,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<string> {
    const session = await this.stripe.checkout.sessions.create({
      customer: user.stripeCustomerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],

      // Trial de 90 jours — configure ici, pas dans le Product
      subscription_data: {
        trial_period_days: 90,
        metadata: { userId: user.id },
      },

      // URLs de retour
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,

      // Paramètres UX
      allow_promotion_codes: true,  // Codes promo
      billing_address_collection: 'auto',
      locale: 'fr',                 // Interface en français

      // Metadata pour retrouver l'utilisateur dans le webhook
      metadata: { userId: user.id },
    });

    return session.url;
  }
}
```

```typescript
// src/billing/billing.controller.ts
@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  @Post('checkout')
  async createCheckout(
    @CurrentUser() user: User,
    @Body() body: { priceId: string },
  ) {
    const url = await this.billingService.createCheckoutSession(
      user,
      body.priceId,
      `${process.env.APP_URL}/settings/billing?success=true`,
      `${process.env.APP_URL}/settings/billing`,
    );
    return { url };
  }
}
```

---

## Frontend : bouton checkout

```typescript
// src/features/billing/PricingPage.tsx

const PLANS = [
  {
    name: 'Premium',
    // Afficher l'annuel en premier → anchoring (Tversky & Kahneman 1974)
    prices: [
      { label: '49€ / an', priceId: process.env.NEXT_PUBLIC_PRICE_PREMIUM_YEARLY, badge: 'Économisez 30%' },
      { label: '4,90€ / mois', priceId: process.env.NEXT_PUBLIC_PRICE_PREMIUM_MONTHLY },
    ],
    features: ['Routines illimitées', 'Gazette hebdomadaire', 'Co-parentalité bridge', 'Livre annuel'],
  },
];

function PricingPage() {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async (priceId: string) => {
    setLoading(true);
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ priceId }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { url } = await res.json();
    window.location.href = url; // Redirection vers Stripe Checkout
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="rounded-xl border p-6 space-y-4">
        <h2 className="font-heading text-xl font-semibold">TribuZen Premium</h2>
        {/* CTA principal : trial mis en avant */}
        <Button className="w-full" size="lg" onClick={() => handleCheckout(PRICE_PREMIUM_YEARLY)}>
          Essayer gratuitement 90 jours
        </Button>
        {/* Rassurance : loss aversion (Kahneman 1979) — après le CTA, pas avant */}
        <p className="text-center text-xs text-muted-foreground">
          Vos souvenirs familiaux vous attendent. Pas de carte débitée pendant 90 jours.
        </p>
      </div>
    </div>
  );
}
```

---

## Page de succès

```typescript
// src/app/settings/billing/page.tsx
export default function BillingPage({ searchParams }: { searchParams: { success?: string } }) {
  return (
    <div>
      {searchParams.success && (
        <div role="status" aria-live="polite" className="rounded-xl bg-primary/10 p-4">
          <p className="font-medium text-primary">
            ✓ Votre essai de 90 jours a commencé !
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Profitez de TribuZen en toute sérénité.
          </p>
        </div>
      )}
    </div>
  );
}
```

---

## Checklist

- [ ] Session Checkout créée depuis NestJS avec trial_period_days: 90
- [ ] Le mode 'subscription' est configuré (pas 'payment')
- [ ] Le plan annuel est proposé en premier dans l'interface (anchoring)
- [ ] Le CTA dit "Essayer gratuitement 90 jours" (pas "S'abonner")
- [ ] La success_url redirige avec session_id pour tracking
- [ ] Locale FR configurée dans la session Checkout
