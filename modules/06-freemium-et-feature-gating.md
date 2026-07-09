---
titre: Freemium et feature gating (entitlements, guard NestJS)
cours: 22-stripe-billing
notions: ["freemium vs premium", "mapper plan vers entitlements", "stocker le statut d'abonnement en base", "ne pas re-appeler Stripe à chaque requête", "gate côté serveur (guard NestJS)", "@RequiresPlan decorator + Reflector", "limites de plan (quotas)", "Stripe Entitlements (survol)", "entitlements.active_entitlement_summary.updated", "ne jamais gater côté client seulement"]
outcomes:
  - sait mapper un plan (price/lookup_key) vers un ensemble de droits (entitlements) applicatifs
  - sait persister le statut d'abonnement en base au lieu de rappeler l'API Stripe à chaque requête
  - sait écrire un guard NestJS qui bloque une feature premium selon le statut en base
  - sait poser des quotas de plan et comprend pourquoi un gate client seul ne protège rien
prerequis: [00-introduction-au-billing-saas, 01-stripe-products-et-prices, 02-stripe-checkout-et-payment-links, 03-webhooks-et-idempotence, 04-subscriptions-et-cycle-de-vie, 05-customer-portal-et-self-service]
next: 07-paiements-echoues-et-dunning
libs: [{ name: stripe, version: "latest" }]
tribuzen: back-office billing TribuZen — la feature "albums photo illimités" réservée à TribuZen Premium, gatée par un guard NestJS lisant le statut en base
last-reviewed: 2026-07
---

# Freemium et feature gating (entitlements, guard NestJS)

> **Outcomes — tu sauras FAIRE :** mapper un plan vers des droits applicatifs, persister le statut d'abonnement en base, écrire un guard NestJS qui bloque une feature premium, et poser des quotas.
> **Difficulté :** :star::star::star:
>
> **Rappel des modules amont.** Le tier vient du **webhook signé** (module 03) : c'est lui qui écrit `subscriptionStatus` et `plan` en base. Le cycle de vie de l'abonnement (`trialing`, `active`, `past_due`, …) est le sujet du module 04. Ce module-ci ne décide pas *qui* est payant — il **applique** cette décision côté API.

## 1. Cas concret d'abord

TribuZen a une feature qui fait vendre : les **albums photo illimités**. En Free, une famille est plafonnée à 1 album ; en **TribuZen Premium**, c'est illimité. Le front affiche déjà un joli cadenas sur le bouton « Créer un album » quand la famille est Free.

Un utilisateur Free ouvre les DevTools, voit l'appel `POST /albums`, et le rejoue à la main avec `curl` :

```bash
# L'utilisateur Free contourne le cadenas du front en appelant l'API directement
curl -X POST https://api.tribuzen.app/albums \
  -H "Authorization: Bearer <son-vrai-JWT>" \
  -d '{"title":"Album 2"}'
# → 201 Created  😱  l'album est créé, la limite Free est bypassée
```

Le cadenas était **uniquement côté client**. Rien côté serveur ne vérifie le plan. Résultat : la feature payante est gratuite pour quiconque sait ouvrir un terminal.

Ce module construit la barrière **côté serveur** : un guard NestJS qui lit le plan de la famille **en base** (pas en rappelant Stripe) et refuse `POST /albums` si la famille n'a pas droit à la feature. Le cadenas front reste — mais pour l'UX, pas pour la sécurité.

---

## 2. Théorie complète, concise

### 2.1 Freemium : le plan décide des droits

Le **freemium** = un palier gratuit (Free) qui donne accès au produit, et un ou plusieurs paliers payants (Premium) qui débloquent des features ou lèvent des limites. Le travail technique du gating, c'est de répondre à une seule question à chaque action sensible : **« ce compte a-t-il le droit de faire ça ? »**

On ne raisonne pas directement « est-ce que l'abonnement Stripe est actif ? » dans chaque controller. On introduit une couche d'abstraction : le **plan** (`free` | `premium`) et un ensemble de **droits** (entitlements) qui en découlent.

### 2.2 Mapper plan → entitlements

Un **entitlement** (droit) est une capacité applicative : « créer des albums illimités », « générer la gazette », « inviter un co-parent ». Le mapping plan → droits est une **table de vérité de ton domaine**, pas un concept Stripe :

| Droit (entitlement applicatif) | Free | Premium |
|---|---|---|
| `albums.unlimited` | ✗ (max 1) | ✓ |
| `gazette.generate` | ✗ | ✓ |
| `coparent.invite` | ✗ | ✓ |
| `journal.history` | 7 jours | illimité |

Ce mapping vit **dans ton code** (une constante), pas éparpillé dans des `if (plan === 'premium')` partout. Un seul endroit à changer quand un droit bascule de palier.

```ts
// src/billing/entitlements.ts — la table de vérité plan → droits
export type Plan = 'free' | 'premium';
export type Entitlement = 'albums.unlimited' | 'gazette.generate' | 'coparent.invite';

const PLAN_ENTITLEMENTS: Record<Plan, ReadonlySet<Entitlement>> = {
  free: new Set(),
  premium: new Set(['albums.unlimited', 'gazette.generate', 'coparent.invite']),
};

export function planHasEntitlement(plan: Plan, ent: Entitlement): boolean {
  return PLAN_ENTITLEMENTS[plan].has(ent);
}
```

Le lien Stripe → plan se fait via le **`lookup_key`** du Price (module 01) : le webhook lit `subscription.items.data[0].price.lookup_key` (ex. `tribuzen_premium_monthly`) et le traduit en `plan: 'premium'` avant de l'écrire en base.

### 2.3 Stocker le statut en base, PAS rappeler Stripe à chaque requête

Tentation : à chaque `POST /albums`, appeler `stripe.subscriptions.retrieve(...)` pour vérifier l'état. **Ne fais jamais ça.** Trois raisons :

1. **Latence.** Un aller-retour réseau vers l'API Stripe (100-300 ms) sur *chaque* requête gatée rend l'API lente.
2. **Rate limits.** Stripe limite les appels API ; ton trafic normal les épuiserait.
3. **Disponibilité.** Si Stripe a un incident, toute ton API tombe alors que la donnée n'a pas changé.

La bonne architecture : **Stripe pousse, tu stockes, tu lis en local.** Le webhook (module 03) écrit `plan` + `subscriptionStatus` sur la ligne `family` en base. Le guard **lit ta base** (déjà chargée avec l'utilisateur, souvent zéro requête supplémentaire). Stripe reste la *source de vérité* de l'événement ; ta base est le *cache autoritaire* que tu interroges.

```
Stripe  --webhook signé-->  ta base (family.plan, family.subscriptionStatus)  <--lit--  guard
        (push, rare)                      (source de lecture)                  (chaque requête)
```

### 2.4 Le statut compte autant que le plan

`plan = 'premium'` ne suffit pas à ouvrir la feature. Un abonnement peut être `premium` mais `past_due` (paiement échoué, module 07) ou `canceled`. Les **statuts qui donnent droit** aux features premium sont :

- `trialing` — période d'essai en cours, accès complet ;
- `active` — abonnement payé et à jour.

Tous les autres (`past_due`, `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`) sont traités **comme Free** pour le gating. (Valeurs de statut Stripe vérifiées sur la doc API courante.)

> **Nuance dunning (module 07) :** en `past_due`, on ne coupe pas forcément Premium *à la seconde*, on laisse une fenêtre de grâce. Ici, on pose la règle stricte par défaut ; l'assouplissement dunning est traité au module 07.

### 2.5 Gater côté serveur : le guard NestJS

Un **guard** NestJS s'exécute **avant** le handler du controller et décide si la requête passe (`return true`) ou est rejetée (`throw` → 403). C'est l'endroit canonique pour le gating d'accès.

On combine deux pièces NestJS :

- un **décorateur** `@RequiresEntitlement('albums.unlimited')` qui attache une metadata à la route (via `SetMetadata`) ;
- un **guard** qui lit cette metadata avec le `Reflector`, lit le plan/statut de l'utilisateur (déjà en base sur `req.user`), et autorise ou refuse.

```ts
// @RequiresEntitlement('albums.unlimited') sur POST /albums
//   → le guard lit la metadata, lit req.user.plan/req.user.subscriptionStatus,
//     et throw ForbiddenException si le droit manque.
```

Point clé : le guard **ne rappelle pas Stripe** et ne fait souvent **aucune requête base** — `req.user` est déjà hydraté par le `JwtAuthGuard` (avec `plan` et `subscriptionStatus`).

### 2.6 Limites de plan (quotas)

Certaines features ne sont pas « tout ou rien » mais **plafonnées** : Free = 1 album, Premium = illimité. Un quota se vérifie en **comptant l'existant** avant de créer :

```ts
const LIMITS: Record<Plan, { albums: number }> = {
  free: { albums: 1 },
  premium: { albums: Infinity },
};
```

Un quota **compte des ressources**, il ne peut donc pas vivre dans un guard générique (qui ne connaît pas la table `albums`) : il vit dans le **service métier**, avant l'insertion. Guard = « as-tu le droit d'utiliser cette feature ? » ; quota = « as-tu encore de la place ? ».

### 2.7 Stripe Entitlements (survol)

Stripe propose une primitive **Entitlements** pour ne pas gérer soi-même la table plan → droits. On attache des **Features** (objet `entitlements.feature`, avec un `lookup_key`) à un **Product** (`product_feature`). Quand un client a un abonnement actif sur ce produit, Stripe calcule ses **droits actifs** (`entitlements.active_entitlement`).

- Lister les droits d'un client : `GET /v1/entitlements/active_entitlements?customer={{CUSTOMER_ID}}`.
- Stripe émet l'event webhook `entitlements.active_entitlement_summary.updated` quand les droits d'un client changent (création, upgrade/downgrade, annulation). On peut donc **s'abonner à cet event** et n'écrire que les `lookup_key` actifs en base — au lieu de mapper soi-même plan → droits.

> **Positionnement pour TribuZen :** on **garde le mapping maison** (§2.2) car il est simple, versionné dans le code et testable hors-ligne. Stripe Entitlements devient intéressant quand le catalogue de features explose ou qu'on veut piloter les droits depuis le Dashboard sans redéployer. Le principe de gating (guard côté serveur, lecture en base) reste identique : Entitlements ne change que *qui remplit* la colonne des droits. <!-- Noms d'objets/events Entitlements vérifiés sur docs.stripe.com (2026-07). -->

### 2.8 Ne jamais gater côté client seulement

Le front **doit** afficher le cadenas (UX : montrer la feature premium, inviter à upgrader). Mais un contrôle client est **cosmétique** : contournable via DevTools, `curl`, ou un client mobile modifié. **Toute règle d'accès payante se rejoue côté serveur.** Le front cache le bouton ; le serveur refuse l'action. Les deux, jamais l'un sans l'autre.

---

## 3. Worked examples

### Exemple 1 — Décorateur + guard d'entitlement (NestJS)

```ts
// src/billing/requires-entitlement.decorator.ts
import { SetMetadata } from '@nestjs/common';
import type { Entitlement } from './entitlements';

export const ENTITLEMENT_KEY = 'requiredEntitlement';

// Attache le droit requis à la route (metadata lue par le guard)
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

// Seuls ces statuts ouvrent les droits premium
const ENTITLING_STATUSES = new Set(['trialing', 'active']);

@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Quel droit cette route exige-t-elle ? (metadata du décorateur)
    const required = this.reflector.get<Entitlement | undefined>(
      ENTITLEMENT_KEY,
      context.getHandler(),
    );
    if (!required) return true; // route non gatée → laisser passer

    // 2. L'utilisateur est déjà hydraté par le JwtAuthGuard : plan + statut EN BASE.
    //    Aucun appel Stripe, aucune requête SQL supplémentaire ici.
    const req = context.switchToHttp().getRequest();
    const user = req.user as { plan: Plan; subscriptionStatus: string };

    // 3. Le statut doit être "entitling" (trialing/active), sinon on traite comme Free
    const statusOk = ENTITLING_STATUSES.has(user.subscriptionStatus);
    const effectivePlan: Plan = statusOk ? user.plan : 'free';

    // 4. Le plan effectif donne-t-il ce droit ?
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
// src/albums/albums.controller.ts — gate déclaratif sur la route
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { EntitlementGuard } from '../billing/entitlement.guard';
import { RequiresEntitlement } from '../billing/requires-entitlement.decorator';

@Controller('albums')
@UseGuards(JwtAuthGuard, EntitlementGuard) // JWT d'abord (hydrate req.user), puis entitlement
export class AlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @Post()
  @RequiresEntitlement('albums.unlimited') // ← la barrière serveur
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAlbumDto) {
    return this.albums.create(user.familyId, dto);
  }
}
```

Ce qu'il illustre : le droit est déclaré **sur la route** (`@RequiresEntitlement`), la logique est centralisée **dans le guard**, et la décision se prend sur des données **déjà en mémoire** (`req.user`) — zéro appel Stripe.

### Exemple 2 — Quota de plan dans le service métier

Le guard d'entitlement bloque la feature « albums illimités » pour les Free. Mais un Free a quand même droit à **1** album : ça, c'est un **quota**, vérifié dans le service.

```ts
// src/albums/albums.service.ts
import { Injectable, ForbiddenException } from '@nestjs/common';
import { planHasEntitlement, type Plan } from '../billing/entitlements';

const ALBUM_LIMIT: Record<Plan, number> = {
  free: 1,
  premium: Infinity,
};

@Injectable()
export class AlbumsService {
  constructor(private readonly repo: AlbumsRepo, private readonly families: FamiliesRepo) {}

  async create(familyId: string, dto: CreateAlbumDto) {
    const family = await this.families.findById(familyId); // plan + statut en base
    const plan: Plan =
      family.subscriptionStatus === 'active' || family.subscriptionStatus === 'trialing'
        ? family.plan
        : 'free';

    // Premium a l'entitlement "albums.unlimited" → pas de quota. Sinon on compte.
    if (!planHasEntitlement(plan, 'albums.unlimited')) {
      const count = await this.repo.countByFamily(familyId);
      if (count >= ALBUM_LIMIT[plan]) {
        throw new ForbiddenException({
          code: 'ALBUM_LIMIT_REACHED',
          limit: ALBUM_LIMIT[plan],
          upgradeUrl: '/settings/billing',
        });
      }
    }
    return this.repo.create(familyId, dto);
  }
}
```

Ce qu'il illustre : le **quota compte l'existant** (`countByFamily`) — impossible dans un guard générique qui ignore la table `albums`. Guard = droit d'accès ; service = place restante. Les deux se complètent.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Gater uniquement côté client

```ts
// ❌ Un cadenas React seul : contournable via DevTools / curl
{family.plan === 'free' ? <LockedButton /> : <CreateAlbumButton />}
// L'API POST /albums reste ouverte à qui rejoue la requête à la main.
```

Le contrôle client est **cosmétique**. La règle d'accès payante se rejoue **côté serveur** (guard). Front = UX, serveur = sécurité. C'est le piège central du module.

### PIÈGE #2 — Rappeler Stripe à chaque requête

```ts
// ❌ Appel réseau Stripe sur chaque action gatée : lent, rate-limité, fragile
const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
if (sub.status !== 'active') throw new ForbiddenException();
```

Le webhook (module 03) a **déjà** écrit `plan` + `subscriptionStatus` en base. Le guard lit ta base (souvent `req.user`, zéro requête). Stripe pousse rarement ; tu lis souvent en local.

### PIÈGE #3 — Vérifier le plan sans vérifier le statut

```ts
// ❌ 'premium' mais past_due / canceled → accès ouvert à tort
if (user.plan === 'premium') return true;
```

Un abonnement peut être `premium` *et* `past_due` (paiement échoué) ou `canceled`. Seuls `trialing` et `active` ouvrent les droits. On calcule un **plan effectif** = plan si statut entitling, sinon `free`.

### PIÈGE #4 — Éparpiller les `if (plan === 'premium')`

```ts
// ❌ La règle de droit dupliquée dans dix controllers
if (user.plan === 'premium') { /* gazette */ }
// ... ailleurs ...
if (user.plan === 'premium') { /* coparent */ }
```

Le jour où un droit change de palier, tu chasses dix `if`. Centralise dans la **table plan → entitlements** (`planHasEntitlement`) et gate via `@RequiresEntitlement`. Une seule source de vérité.

### PIÈGE #5 — Mettre un quota dans le guard

```ts
// ❌ Le guard ne connaît pas la table albums → il ne PEUT pas compter
@RequiresEntitlement('albums.max_1') // un quota déguisé en entitlement booléen
```

Un guard répond « as-tu le droit ? » (booléen), pas « combien en as-tu déjà ? ». Le **quota compte l'existant** dans le service métier, avant l'insertion. Ne mélange pas les deux responsabilités.

### PIÈGE #6 — Confondre entitlement applicatif et Stripe Entitlements

Un **entitlement applicatif** (`albums.unlimited`) est *ta* notion de droit, dans *ton* code. **Stripe Entitlements** est un *service Stripe* optionnel (`entitlements.feature`, `product_feature`, event `entitlements.active_entitlement_summary.updated`) qui peut *remplir* tes droits à ta place. Tu peux faire tout le gating **sans** Stripe Entitlements. Ne crois pas qu'il faut l'activer pour gater : le guard côté serveur reste la barrière, quelle que soit la source des droits.

---

## 5. Ancrage TribuZen

Le gating est la **monétisation concrète** de TribuZen : c'est lui qui rend Premium désirable et Free limité, sans jamais ouvrir une faille.

Flux réel de la feature « albums photo illimités » :

1. Le webhook (module 03) a écrit `family.plan = 'premium'` et `family.subscriptionStatus = 'active'` en base à l'activation.
2. Le `JwtAuthGuard` hydrate `req.user` avec `plan` + `subscriptionStatus` (déjà chargés avec l'utilisateur).
3. Un parent Premium `POST /albums` → `EntitlementGuard` voit `albums.unlimited` accordé → 201.
4. Un parent Free `POST /albums` alors qu'il a déjà 1 album → le guard laisse passer (l'entitlement n'est pas exigé pour le *1er* album… ou bien on exige l'entitlement dès le 2e via le quota du service) → `AlbumsService` compte, voit `count >= 1`, → 403 `ALBUM_LIMIT_REACHED`.
5. Le front affiche le cadenas + CTA « Passer à Premium » — cosmétique ; la vraie barrière est le 403 serveur.

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen-api/
  src/
    billing/
      entitlements.ts                    ← table plan → droits + planHasEntitlement
      requires-entitlement.decorator.ts  ← @RequiresEntitlement
      entitlement.guard.ts               ← Exemple 1 (guard)
    albums/
      albums.controller.ts               ← @RequiresEntitlement('albums.unlimited')
      albums.service.ts                  ← Exemple 2 (quota Free = 1 album)
```

> Le plan et le statut arrivent *du webhook signé* (module 03) ; les transitions fines (`past_due`, grâce dunning) sont approfondies au **module 07**. Ici, on garantit que la feature payante est **infranchissable côté serveur**.

---

## 6. Points clés

1. Le **freemium** = paliers de droits ; le gating répond « ce compte a-t-il le droit de faire ça ? » à chaque action sensible.
2. Le mapping **plan → entitlements** est une table de vérité *dans ton code* (`planHasEntitlement`), pas des `if (plan === 'premium')` éparpillés.
3. On **stocke le statut en base** (écrit par le webhook) et on lit en local — **jamais** rappeler Stripe à chaque requête (latence, rate limits, disponibilité).
4. Le **plan seul ne suffit pas** : seuls les statuts `trialing` et `active` ouvrent les droits ; sinon plan effectif = `free`.
5. Le **guard NestJS** (`@RequiresEntitlement` + `Reflector`) gate déclarativement la route, sur `req.user` déjà hydraté — zéro appel Stripe.
6. Un **quota** (Free = 1 album) compte l'existant dans le **service métier**, pas dans le guard.
7. **Stripe Entitlements** (`entitlements.feature`, `product_feature`, event `entitlements.active_entitlement_summary.updated`) est une alternative optionnelle pour piloter les droits ; le gating serveur reste identique.
8. **Ne jamais gater côté client seulement** : le front cache le bouton (UX), le serveur refuse l'action (sécurité).

---

## 7. Seeds Anki

```
Pourquoi un gate uniquement côté client ne protège rien ?|Un cadenas React/Vue est cosmétique : contournable via DevTools, curl ou un client modifié. La règle d'accès payante doit se rejouer côté serveur (guard). Front = UX, serveur = sécurité.
Pourquoi ne pas rappeler Stripe (subscriptions.retrieve) à chaque requête gatée ?|Latence (100-300 ms/requête), rate limits Stripe, et fragilité si Stripe a un incident. Le webhook écrit plan + subscriptionStatus en base ; le guard lit ta base (souvent req.user, zéro requête).
Le plan 'premium' suffit-il à ouvrir une feature premium ?|Non. Un abonnement peut être premium mais past_due ou canceled. Seuls les statuts trialing et active ouvrent les droits ; sinon on calcule un plan effectif = free.
Différence entre un guard d'entitlement et un quota de plan ?|Le guard répond « as-tu le droit d'utiliser cette feature ? » (booléen, sur req.user). Le quota répond « as-tu encore de la place ? » : il compte l'existant (countByFamily) dans le service métier avant l'insertion.
Comment mapper un plan Stripe vers des droits applicatifs sans éparpiller les if ?|Une table de vérité dans le code : Record<Plan, Set<Entitlement>> + planHasEntitlement(plan, ent). Le lien Stripe → plan se fait via le lookup_key du Price, traduit par le webhook. Une seule source à changer.
Que sont Stripe Entitlements et sont-ils obligatoires pour gater ?|Un service Stripe optionnel : Features (entitlements.feature) attachées à un Product (product_feature), droits actifs calculés (entitlements.active_entitlement), event entitlements.active_entitlement_summary.updated. Optionnel : on peut gater entièrement avec un mapping maison.
Quels statuts d'abonnement Stripe ouvrent les droits premium dans TribuZen ?|trialing et active. Tous les autres (past_due, canceled, unpaid, incomplete, incomplete_expired, paused) sont traités comme Free pour le gating (assouplissement dunning past_due vu au module 07).
Comment un décorateur @RequiresEntitlement communique-t-il avec le guard NestJS ?|Le décorateur pose une metadata via SetMetadata sur la route ; le guard la lit avec le Reflector (reflector.get), puis compare au plan effectif de req.user. Si le droit manque → ForbiddenException (403).
```

---

## Pont vers le lab

> Lab associé : `labs/lab-06-freemium-et-feature-gating/README.md`. Construire un guard NestJS qui bloque une feature Premium (albums illimités) selon le statut en base — vrai SDK NestJS, décorateur + Reflector, zéro appel Stripe à la requête, corrigé complet commenté.
