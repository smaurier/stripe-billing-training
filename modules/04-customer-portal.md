# Module 04 — Customer Portal

| Difficulté | Durée estimée |
|------------|---------------|
| 2/5        | 45 min        |

## Objectifs
- Activer le Customer Portal Stripe
- Créer le lien d'accès depuis NestJS
- Comprendre ce que le portail gère nativement

---

## Qu'est-ce que le Customer Portal ?

Le Customer Portal = page hébergée par Stripe où l'utilisateur peut :
- Voir et mettre à jour son abonnement
- Changer de plan (upgrade/downgrade)
- Annuler son abonnement
- Télécharger ses factures
- Mettre à jour sa carte bancaire

**Pour TribuZen MVP** : n'implémenter aucune de ces fonctionnalités toi-même. Le Customer Portal les gère toutes, gratuitement, en conformité PCI et RGPD.

---

## Configurer dans le Dashboard Stripe

```
Stripe Dashboard → Settings → Billing → Customer portal

Configurer :
  ✅ Allow customers to update subscriptions
  ✅ Allow customers to cancel subscriptions
      → Cancellation feedback (obligatoire pour comprendre le churn)
      → Immediately OR at end of period (choisir "at end of period")
  ✅ Invoice history
  ✅ Update payment methods
```

---

## Créer le lien d'accès (NestJS)

```typescript
// src/billing/billing.service.ts

async createPortalSession(user: User, returnUrl: string): Promise<string> {
  const session = await this.stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: returnUrl, // URL de retour après fermeture du portail
  });
  return session.url;
}
```

```typescript
// src/billing/billing.controller.ts

@Post('portal')
@UseGuards(JwtAuthGuard)
async createPortal(@CurrentUser() user: User) {
  const url = await this.billingService.createPortalSession(
    user,
    `${process.env.APP_URL}/settings/billing`,
  );
  return { url };
}
```

```typescript
// Frontend
function BillingSettings({ user }: { user: User }) {
  const openPortal = async () => {
    const res = await fetch('/api/billing/portal', { method: 'POST' });
    const { url } = await res.json();
    window.location.href = url;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4">
        <p className="font-medium">Abonnement {user.tier}</p>
        <p className="text-sm text-muted-foreground">
          {user.subscriptionStatus === 'trialing'
            ? `Essai jusqu'au ${format(user.trialEnd, 'dd MMMM yyyy', { locale: fr })}`
            : `Renouvellement le ${format(user.currentPeriodEnd, 'dd MMMM yyyy', { locale: fr })}`
          }
        </p>
      </div>
      <Button variant="outline" onClick={openPortal}>
        Gérer mon abonnement
      </Button>
    </div>
  );
}
```

---

## Checklist

- [ ] Customer Portal activé dans le Dashboard Stripe avec la configuration correcte
- [ ] Annulation = "at end of period" (pas immédiatement)
- [ ] L'endpoint `/billing/portal` crée et retourne l'URL de session
- [ ] Le bouton "Gérer mon abonnement" est accessible depuis les paramètres
- [ ] Le return_url ramène sur la page paramètres billing
