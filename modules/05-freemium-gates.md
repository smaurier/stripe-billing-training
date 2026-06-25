# Module 05 — Freemium Gates & Guards NestJS

| Difficulté | Durée estimée |
|------------|---------------|
| 3/5        | 60 min        |

## Objectifs
- Implémenter un Guard NestJS vérifiant le tier
- Créer un décorateur `@RequiresTier`
- Bloquer les fonctionnalités premium côté API et UI
- Gérer la dégradation gracieuse en fin de trial

---

## Architecture Freemium TribuZen

```
FREE :
  ├── Jusqu'à 3 routines
  ├── Dashboard famille basique
  └── Journal 7 derniers jours

PREMIUM (trial 90j → 4,90€/mois ou 49€/an) :
  ├── Routines illimitées
  ├── Gazette hebdomadaire
  ├── Co-parentalité bridge (ex conflictuels)
  ├── Livre annuel (Cheerz/Fizzer)
  └── Planificateur repas complet

FAMILLE (7,90€/mois ou 79€/an) :
  ├── Tout Premium
  ├── Jusqu'à 8 co-référents
  └── Multi-familles (garde alternée, famille recomposée)
```

---

## Guard NestJS

```typescript
// src/auth/guards/tier.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

type Tier = 'free' | 'premium' | 'family';
const TIERS_ORDER: Tier[] = ['free', 'premium', 'family'];

@Injectable()
export class TierGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredTier = this.reflector.get<Tier>('requiredTier', context.getHandler());
    if (!requiredTier) return true; // Pas de restriction

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Vérifier si le tier de l'utilisateur est suffisant
    const userTierIndex = TIERS_ORDER.indexOf(user.tier);
    const requiredTierIndex = TIERS_ORDER.indexOf(requiredTier);

    if (userTierIndex < requiredTierIndex) {
      throw new ForbiddenException({
        code: 'TIER_REQUIRED',
        requiredTier,
        currentTier: user.tier,
        upgradeUrl: '/settings/billing',
      });
    }

    // Vérifier que l'abonnement est actif (pas past_due ou canceled)
    const activeStatuses = ['active', 'trialing'];
    if (user.tier !== 'free' && !activeStatuses.includes(user.subscriptionStatus)) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_INACTIVE',
        status: user.subscriptionStatus,
        upgradeUrl: '/settings/billing',
      });
    }

    return true;
  }
}
```

```typescript
// src/auth/decorators/requires-tier.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const RequiresTier = (tier: 'premium' | 'family') =>
  SetMetadata('requiredTier', tier);
```

```typescript
// Enregistrer globalement dans app.module.ts
APP_GUARD: { provide: APP_GUARD, useClass: TierGuard }
```

---

## Utilisation dans les controllers

```typescript
// src/routines/routines.controller.ts

@Get()
async getRoutines(@CurrentUser() user: User) {
  const routines = await this.routinesService.findByFamily(user.familyId);

  // Gate soft : retourner les 3 premières pour les utilisateurs free
  if (user.tier === 'free') {
    return { routines: routines.slice(0, 3), limited: true, total: routines.length };
  }
  return { routines, limited: false };
}

@Post()
@RequiresTier('premium')  // Guard bloque si tier < premium
async createRoutine(@CurrentUser() user: User, @Body() dto: CreateRoutineDto) {
  // Vérification supplémentaire : max 3 pour les free (déjà bloqué par le guard mais double sécurité)
  const count = await this.routinesService.countByFamily(user.familyId);
  if (user.tier === 'free' && count >= 3) {
    throw new ForbiddenException({ code: 'ROUTINE_LIMIT_REACHED', limit: 3 });
  }
  return this.routinesService.create(user.familyId, dto);
}

@Post('gazette/generate')
@RequiresTier('premium')
async generateGazette(@CurrentUser() user: User) {
  return this.gazetteService.generate(user.familyId);
}

@Post('co-parent/invite')
@RequiresTier('premium')  // Co-parentalité bridge = premium minimum
async inviteCoParent(@CurrentUser() user: User, @Body() dto: InviteCoParentDto) {
  return this.familyService.inviteCoParent(user.familyId, dto);
}
```

---

## Frontend : feature locked state

```typescript
// src/components/FeatureGate.tsx
interface FeatureGateProps {
  feature: string;
  requiredTier: 'premium' | 'family';
  currentTier: string;
  children: React.ReactNode;
}

export function FeatureGate({ feature, requiredTier, currentTier, children }: FeatureGateProps) {
  const TIER_ORDER = ['free', 'premium', 'family'];
  const hasAccess = TIER_ORDER.indexOf(currentTier) >= TIER_ORDER.indexOf(requiredTier);

  if (hasAccess) return <>{children}</>;

  return (
    <div className="relative">
      {/* Contenu flouté */}
      <div className="pointer-events-none select-none blur-sm opacity-50" aria-hidden="true">
        {children}
      </div>
      {/* Overlay CTA */}
      <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/80">
        <div className="text-center space-y-3 p-4">
          <p className="font-medium text-foreground">Fonctionnalité {requiredTier}</p>
          <Button asChild size="sm">
            <Link href="/settings/billing">Essayer gratuitement 90 jours</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

// Usage
<FeatureGate feature="gazette" requiredTier="premium" currentTier={user.tier}>
  <GazettePreview />
</FeatureGate>
```

---

## Checklist

- [ ] TierGuard implémenté et enregistré globalement
- [ ] `@RequiresTier('premium')` décorateur créé et utilisé
- [ ] Les statuses `past_due` et `canceled` sont bloqués comme `free`
- [ ] Erreur retournée avec `code`, `requiredTier`, `upgradeUrl`
- [ ] `FeatureGate` composant frontend avec contenu flouté + CTA
- [ ] Les limits soft (3 routines max) sont gérés côté API, pas que frontend
