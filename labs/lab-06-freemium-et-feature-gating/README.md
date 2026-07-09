# Lab 06 — Freemium et feature gating

> **Outcome :** à la fin, tu sais écrire un **guard NestJS** qui bloque une feature Premium (les albums photo illimités de TribuZen) selon le **plan + statut d'abonnement lus en base**, sans jamais rappeler Stripe à la requête.
> **Vrai outil :** NestJS (`CanActivate`, `Reflector`, `SetMetadata`, `ForbiddenException`) — pas de harnais simulé.
> **Feedback :** le coach valide en session (pas de test-runner auto-correcteur).

---

## Énoncé

Dans l'API TribuZen, la route `POST /albums` doit être **réservée au plan Premium** (feature « albums photo illimités »). Un utilisateur Free qui rejoue la requête au `curl` doit recevoir un **403**, pas un 201.

Tu écris trois fichiers dans un module NestJS existant :

1. `entitlements.ts` — la table de vérité `plan → droits` + un helper `planHasEntitlement`.
2. `requires-entitlement.decorator.ts` — un décorateur `@RequiresEntitlement('albums.unlimited')`.
3. `entitlement.guard.ts` — le guard qui lit la metadata + `req.user` (déjà hydraté par le JWT) et autorise/refuse.

**Contraintes non négociables :**

- Le guard **ne rappelle pas Stripe** et ne fait **aucune requête base** : il lit `req.user.plan` et `req.user.subscriptionStatus` (posés par le `JwtAuthGuard` en amont).
- Seuls les statuts `trialing` et `active` ouvrent le droit. `past_due`, `canceled`, etc. → traités comme Free.
- Le refus est un `ForbiddenException` avec un corps exploitable (`code`, `entitlement`, `upgradeUrl`).

**Pas de gap-fill** — tu écris les trois fichiers à partir du starter minimal.

### Starter minimal

On suppose un `JwtAuthGuard` déjà en place qui pose sur `req.user` (au minimum) :

```ts
// forme de req.user après le JwtAuthGuard (donné, ne pas réécrire)
interface AuthUser {
  id: string;
  familyId: string;
  plan: 'free' | 'premium';          // écrit en base par le webhook (module 03)
  subscriptionStatus: string;         // 'trialing' | 'active' | 'past_due' | 'canceled' | ...
}
```

Squelette des fichiers à compléter :

```ts
// src/billing/entitlements.ts
export type Plan = 'free' | 'premium';
export type Entitlement = 'albums.unlimited'; // (le lab n'a besoin que d'un droit)
// À toi : PLAN_ENTITLEMENTS + planHasEntitlement(plan, ent): boolean
```

```ts
// src/billing/requires-entitlement.decorator.ts
import { SetMetadata } from '@nestjs/common';
// À toi : ENTITLEMENT_KEY + RequiresEntitlement(ent)
```

```ts
// src/billing/entitlement.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
// À toi : lire la metadata, calculer le plan effectif (statut), autoriser/refuser
```

Branche le guard sur le controller albums :

```ts
// src/albums/albums.controller.ts (donné, à décorer)
@Controller('albums')
@UseGuards(JwtAuthGuard, EntitlementGuard) // JWT d'abord, entitlement ensuite
export class AlbumsController {
  @Post()
  // ← ajoute ici @RequiresEntitlement('albums.unlimited')
  create(/* ... */) { /* ... */ }
}
```

---

## Étapes (en friction)

1. **Table plan → droits** — dans `entitlements.ts`, un `Record<Plan, ReadonlySet<Entitlement>>` : `free` = set vide, `premium` = `{ 'albums.unlimited' }`. Expose `planHasEntitlement(plan, ent): boolean`.
2. **Décorateur** — `ENTITLEMENT_KEY = 'requiredEntitlement'`, et `RequiresEntitlement(ent)` qui fait `SetMetadata(ENTITLEMENT_KEY, ent)`.
3. **Guard — lire la metadata** — dans `canActivate`, `reflector.get<Entitlement>(ENTITLEMENT_KEY, context.getHandler())`. Si absente → `return true` (route non gatée).
4. **Guard — plan effectif** — lis `req.user`. Si `subscriptionStatus` ∈ `{ 'trialing', 'active' }` → `plan effectif = user.plan`, sinon `'free'`. (C'est LE point qui fait échouer les débutants : ne pas oublier le statut.)
5. **Guard — décision** — si `planHasEntitlement(effectivePlan, required)` → `return true`, sinon `throw new ForbiddenException({ code: 'ENTITLEMENT_REQUIRED', entitlement: required, upgradeUrl: '/settings/billing' })`.
6. **Décore la route** — `@RequiresEntitlement('albums.unlimited')` sur `POST /albums`.
7. **Vérifie à la main** (4 cas) : Premium/`active` → 201 ; Premium/`past_due` → 403 ; Free/`active` → 403 ; route sans décorateur → passe toujours.

---

## Corrigé complet commenté

```ts
// src/billing/entitlements.ts
// La table de vérité plan → droits. UNE seule source à changer quand un droit bascule de palier.
export type Plan = 'free' | 'premium';
export type Entitlement = 'albums.unlimited';

const PLAN_ENTITLEMENTS: Record<Plan, ReadonlySet<Entitlement>> = {
  free: new Set(),                             // Free : aucun droit premium
  premium: new Set(['albums.unlimited']),      // Premium : albums illimités
};

// Helper pur, testable hors-ligne, sans dépendance NestJS ni Stripe
export function planHasEntitlement(plan: Plan, ent: Entitlement): boolean {
  return PLAN_ENTITLEMENTS[plan].has(ent);
}
```

```ts
// src/billing/requires-entitlement.decorator.ts
import { SetMetadata } from '@nestjs/common';
import type { Entitlement } from './entitlements';

// Clé partagée entre le décorateur (écrit) et le guard (lit via Reflector)
export const ENTITLEMENT_KEY = 'requiredEntitlement';

// Attache le droit requis en metadata sur la route
export const RequiresEntitlement = (ent: Entitlement) =>
  SetMetadata(ENTITLEMENT_KEY, ent);
```

```ts
// src/billing/entitlement.guard.ts
import {
  Injectable, CanActivate, ExecutionContext, ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ENTITLEMENT_KEY } from './requires-entitlement.decorator';
import { planHasEntitlement, type Entitlement, type Plan } from './entitlements';

// Seuls ces statuts d'abonnement Stripe ouvrent les droits premium.
// (past_due / canceled / unpaid / incomplete / paused → traités comme Free.)
const ENTITLING_STATUSES = new Set(['trialing', 'active']);

@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Droit exigé par la route (metadata posée par @RequiresEntitlement)
    const required = this.reflector.get<Entitlement | undefined>(
      ENTITLEMENT_KEY,
      context.getHandler(),
    );
    if (!required) return true; // route non gatée → on laisse passer

    // 2. req.user est DÉJÀ hydraté par le JwtAuthGuard (plan + statut lus en base).
    //    → aucun appel Stripe, aucune requête SQL supplémentaire ici.
    const req = context.switchToHttp().getRequest();
    const user = req.user as { plan: Plan; subscriptionStatus: string };

    // 3. Plan effectif : le statut compte autant que le plan.
    //    premium + past_due  →  effectif 'free'  (pas de droit)
    const statusOk = ENTITLING_STATUSES.has(user.subscriptionStatus);
    const effectivePlan: Plan = statusOk ? user.plan : 'free';

    // 4. Décision
    if (!planHasEntitlement(effectivePlan, required)) {
      throw new ForbiddenException({
        code: 'ENTITLEMENT_REQUIRED',
        entitlement: required,
        currentPlan: user.plan,
        subscriptionStatus: user.subscriptionStatus,
        upgradeUrl: '/settings/billing',
      });
    }
    return true;
  }
}
```

```ts
// src/albums/albums.controller.ts — la route gatée
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { EntitlementGuard } from '../billing/entitlement.guard';
import { RequiresEntitlement } from '../billing/requires-entitlement.decorator';

@Controller('albums')
@UseGuards(JwtAuthGuard, EntitlementGuard) // ORDRE : JWT hydrate req.user, PUIS entitlement le lit
export class AlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @Post()
  @RequiresEntitlement('albums.unlimited') // ← la barrière serveur
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAlbumDto) {
    return this.albums.create(user.familyId, dto);
  }
}
```

**Pourquoi ce corrigé est correct :**
- Le guard décide sur `req.user` **déjà en mémoire** — zéro appel Stripe, zéro requête base : rapide, robuste à un incident Stripe.
- Le **plan effectif** intègre le statut : un `premium` en `past_due` retombe en `free`, donc perd le droit. C'est le comportement attendu du gating strict (l'assouplissement dunning est au module 07).
- L'**ordre des guards** compte : `JwtAuthGuard` d'abord (il pose `req.user`), `EntitlementGuard` ensuite (il le lit). Inversés, `req.user` serait `undefined`.
- La règle vit dans **une seule** table (`PLAN_ENTITLEMENTS`) ; ajouter un droit ne touche ni le guard ni les controllers.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées.** Reproduis les trois fichiers **de mémoire, en 25 minutes**, sans rouvrir ce corrigé ni le module 06, avec ces ajouts :

1. **Quota Free** — la feature n'est plus binaire : un Free a droit à **1 album**. Écris un `AlbumsService.create` qui, si le plan effectif n'a pas `albums.unlimited`, **compte** les albums existants (`countByFamily`) et throw `ALBUM_LIMIT_REACHED` au-delà de 1. (Rappel : le quota vit dans le **service**, pas le guard — il doit compter une ressource.)
2. **Deuxième droit** — ajoute `'gazette.generate'` à la table et gate une route `POST /gazette` avec, sans toucher au guard.

**Critère de réussite :** un Free crée son 1er album (201), échoue au 2e (403 `ALBUM_LIMIT_REACHED`), et `POST /gazette` lui renvoie 403 — le tout sans dupliquer de logique de plan dans les controllers.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ces fichiers vivent ici :

```
tribuzen-api/
  src/
    billing/
      entitlements.ts                    ← table plan → droits
      requires-entitlement.decorator.ts  ← @RequiresEntitlement
      entitlement.guard.ts               ← le guard
    albums/
      albums.controller.ts               ← @RequiresEntitlement('albums.unlimited')
      albums.service.ts                  ← quota Free = 1 album (variante J+30)
```

**Différences par rapport au lab :**

- `req.user.plan` et `req.user.subscriptionStatus` sont écrits en base par le **webhook signé** (module 03), pas simulés — ici on suppose le JWT déjà branché.
- En production, le guard peut être enregistré **globalement** (`APP_GUARD`) plutôt que par controller, avec `@RequiresEntitlement` comme opt-in par route.
- Le front TribuZen affiche un cadenas + CTA « Passer à Premium » (UX) ; la vraie barrière reste ce 403 serveur. Front et serveur, jamais l'un sans l'autre.

**Commit cible :**
```
feat(billing): EntitlementGuard — gate serveur albums illimités selon plan+statut en base
```
