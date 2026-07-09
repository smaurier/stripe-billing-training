---
titre: Webhooks Stripe et idempotence (NestJS)
cours: 22-stripe-billing
notions: ["pourquoi les webhooks", "ne jamais se fier au success_url", "header stripe-signature", "constructEvent", "raw body", "checkout.session.completed", "customer.subscription.*", "invoice.payment_failed", "idempotence via event.id", "sécuriser l'endpoint NestJS"]
outcomes:
  - sait expliquer pourquoi l'état payant se décide sur webhook et jamais sur le success_url
  - sait vérifier la signature stripe-signature avec constructEvent en fournissant le raw body
  - sait router les events clés (checkout.session.completed, customer.subscription.*, invoice.payment_failed)
  - sait rendre un handler webhook idempotent via event.id déjà traité
prerequis: [00-introduction-au-billing-saas, 01-stripe-products-et-prices, 02-stripe-checkout-et-payment-links]
next: 04-subscriptions-et-cycle-de-vie
libs: [{ name: stripe, version: "latest" }]
tribuzen: back-office billing TribuZen — activation de TribuZen Premium à la réception du webhook signé, jamais au retour navigateur
last-reviewed: 2026-07
---

# Webhooks Stripe et idempotence (NestJS)

> **Outcomes — tu sauras FAIRE :** vérifier la signature d'un webhook Stripe avec `constructEvent` sur le raw body, router les events clés, et rendre le handler idempotent via `event.id`.
> **Difficulté :** :star::star::star::star:
>
> **⚠️ Module sécurité.** La vérification de signature est **obligatoire et défensive** : un endpoint webhook non vérifié est une porte ouverte pour activer Premium gratuitement chez n'importe qui. Ne jamais désactiver `constructEvent`, même « temporairement pour tester ».

## 1. Cas concret d'abord

Dans le module 02, l'utilisateur clique « Essayer gratuitement 90 jours », il est redirigé vers Stripe Checkout, paie, puis Stripe le renvoie sur ton `success_url`. Tentation naturelle : sur cette page de succès, tu passes le compte en Premium.

```ts
// ❌ Le piège classique — activer Premium sur le success_url
// GET /settings/billing?success=true  →  user.tier = 'premium'
```

Trois façons dont ça casse en production TribuZen :

1. **L'URL est devinable.** `?success=true` est dans la barre d'adresse. N'importe qui tape l'URL et devient Premium sans payer.
2. **Le paiement peut échouer *après* la redirection.** Sur un abonnement avec 3D Secure ou un prélèvement asynchrone, Checkout peut rediriger avant que le paiement soit confirmé. Tu actives Premium pour un paiement qui ne passera jamais.
3. **L'utilisateur ferme l'onglet.** Il paie, son wifi coupe, il ne voit jamais le `success_url`. Il a payé mais reste en Free. Support en colère.

La solution : **Stripe appelle *ton serveur*** quand un événement réel se produit (paiement confirmé, abonnement créé, paiement échoué). Ce message serveur-à-serveur signé cryptographiquement s'appelle un **webhook**. C'est la seule source de vérité pour décider qui est Premium.

Ce module construit l'endpoint webhook NestJS : signé, routé, idempotent.

---

## 2. Théorie complète, concise

### 2.1 Pourquoi un webhook, et pas le retour navigateur

Le `success_url` est un événement **côté client** : contrôlé par le navigateur de l'utilisateur, donc **ni fiable ni sûr**. Il sert uniquement à l'UX (afficher « merci ! »).

Le webhook est un événement **côté serveur** : Stripe fait une requête HTTP `POST` vers une URL de *ton* API quand un fait comptable se produit. Personne ne peut le forger s'il est signé. C'est la source de vérité de l'état payant.

| | `success_url` (navigateur) | Webhook (serveur) |
|---|---|---|
| Déclenché par | Redirection navigateur | Stripe → ton API |
| Falsifiable | Oui (URL visible) | Non (signé) |
| Arrive si l'onglet est fermé | Non | Oui |
| Reflète un paiement *confirmé* | Pas garanti | Oui |
| Rôle | UX (« merci ! ») | Décider Premium/Free |

> **Règle TribuZen :** le `success_url` affiche un message. Le **webhook** change `user.tier`. Jamais l'inverse.

### 2.2 La signature `Stripe-Signature` et `constructEvent`

Ton endpoint webhook est une URL publique. N'importe qui sur Internet peut lui envoyer un faux `POST` prétendant être « paiement réussi ». Sans vérification, tu actives Premium pour un attaquant.

Stripe signe chaque webhook. La requête arrive avec un header `Stripe-Signature` (un HMAC calculé avec un **secret de signature** propre à ton endpoint, `whsec_...`). Le SDK vérifie cette signature avec `stripe.webhooks.constructEvent` :

```ts
const event = stripe.webhooks.constructEvent(
  rawBody,        // le CORPS BRUT de la requête (Buffer/string, PAS l'objet JSON parsé)
  signature,      // la valeur du header 'stripe-signature'
  webhookSecret,  // process.env.STRIPE_WEBHOOK_SECRET → 'whsec_...'
);
```

`constructEvent` fait deux choses en une :
- **si la signature est valide** → il retourne l'objet `Stripe.Event` typé et parsé ;
- **si la signature est invalide** (payload modifié, mauvais secret, requête forgée) → il **lève une exception**. Tu réponds alors `400` et tu ne traites rien.

C'est la seule barrière entre le monde extérieur et ton `user.tier`. Elle est non négociable.

### 2.3 Pourquoi le *raw body* est indispensable

La signature est calculée sur les **octets exacts** envoyés par Stripe. Si un middleware `body-parser` / `express.json()` parse le corps en objet JavaScript puis le re-sérialise, l'ordre des clés ou l'espacement peuvent changer d'un octet — et la signature ne correspond plus. `constructEvent` échoue systématiquement.

Il faut donc que la route webhook reçoive le **corps brut non parsé**. Dans NestJS, on active `rawBody` à la création de l'app :

```ts
// main.ts
const app = await NestFactory.create(AppModule, {
  rawBody: true, // expose req.rawBody — requis pour constructEvent
});
```

`req.rawBody` (type `RawBodyRequest<Request>`) contient alors le Buffer brut, à passer tel quel à `constructEvent`. Le reste de l'API peut continuer à utiliser le JSON parsé normalement.

### 2.4 Les events clés d'un billing d'abonnement

Un event a un `type` (string) et un `data.object` (l'objet Stripe concerné, à caster selon le type). Les events à router pour TribuZen Premium :

| `event.type` | Sens | Action TribuZen |
|---|---|---|
| `checkout.session.completed` | Le Checkout a abouti | Rattacher le `stripeCustomerId` à l'utilisateur |
| `customer.subscription.created` | Abonnement créé (parfois `incomplete`) | Enregistrer l'abonnement, démarrer le trial |
| `customer.subscription.updated` | Renouvellement, changement de plan, statut | Recalculer le tier + `subscriptionStatus` |
| `customer.subscription.deleted` | Abonnement terminé/annulé | Repasser en Free (fin de période) |
| `customer.subscription.trial_will_end` | 3 jours avant fin du trial | Email « ton essai expire bientôt » |
| `invoice.paid` | Facture payée avec succès | Étendre la période payante |
| `invoice.payment_failed` | Échec de paiement (dunning) | Passer en `past_due`, relancer |

> **⚠️ Ne jamais inventer un nom d'event.** Les noms ci-dessus sont ceux de la doc Stripe courante. Note : l'event de succès de facture recommandé aujourd'hui est **`invoice.paid`** ; l'ancien alias `invoice.payment_succeeded` existe encore mais `invoice.paid` est le nom courant. Vérifie toujours sur `docs.stripe.com` avant d'ajouter un `case`.

Deux règles de routage :
- **Ne route que ce que tu comprends.** Stripe envoie des dizaines de types d'events. Le `default` du switch **ignore** les autres — il ne throw pas.
- **Le point de vérité pour Premium**, ce sont les `customer.subscription.*` (statut + price). `checkout.session.completed` sert surtout à lier le customer.

### 2.5 Idempotence via `event.id`

Stripe **peut livrer le même event plusieurs fois** : coupure réseau, timeout de ton serveur, retry automatique (jusqu'à 3 jours en production). Ton handler doit donc être **idempotent** : le traiter 2 fois donne le même résultat que 1 fois.

Chaque event a un identifiant stable `event.id` (`evt_...`). La protection : **enregistrer les `event.id` déjà traités**, et ignorer un event déjà vu.

```ts
const seen = await this.processedEvents.has(event.id);
if (seen) return; // déjà traité → on ne rejoue pas
// ... traitement ...
await this.processedEvents.mark(event.id); // marquer traité
```

Le stockage peut être une table Postgres (`processed_webhook_events(event_id PK, processed_at)`) ou une clé Redis avec TTL. L'essentiel : le check et le marquage encadrent le traitement, idéalement dans la **même transaction** que la mise à jour métier, pour qu'un crash au milieu ne laisse pas un event « à moitié traité et marqué ».

### 2.6 Sécuriser et bien répondre l'endpoint NestJS

Règles défensives pour l'endpoint :

- **Vérifier la signature avant TOUT.** Aucune lecture de `event.data` avant `constructEvent`.
- **Header manquant → 400.** Pas de header `stripe-signature` = requête suspecte.
- **Signature invalide → 400.** On répond 400 (Stripe considère ≥ 2xx comme « reçu »).
- **Traité avec succès → 2xx *vite*.** Stripe attend une réponse rapide (quelques secondes). Le gros travail (emails, etc.) part en tâche de fond ; le webhook répond `200` dès que l'event est enregistré de façon fiable.
- **Une erreur *de ton* traitement → 5xx.** Si tu réponds 5xx, Stripe **réessaiera** — utile combiné à l'idempotence. Si tu réponds 2xx, Stripe considère l'event livré et ne rejoue pas.
- **Pas d'auth applicative (JWT) sur cette route.** L'appelant est Stripe, pas un utilisateur connecté. La signature *est* l'authentification.

---

## 3. Worked examples

### Exemple 1 — Endpoint webhook signé (controller NestJS)

```ts
// src/billing/stripe-webhook.controller.ts
import {
  Controller, Post, Headers, Req, HttpCode,
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
    // 1. Header manquant → requête suspecte, on refuse
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    // 2. Vérification de signature — AVANT toute lecture du payload
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        req.rawBody as Buffer,               // corps BRUT (rawBody: true dans main.ts)
        signature,                            // header stripe-signature
        process.env.STRIPE_WEBHOOK_SECRET!,   // 'whsec_...' — jamais commité
      );
    } catch (err) {
      // Signature invalide = payload forgé ou mauvais secret → 400, on ne traite rien
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new BadRequestException(`Webhook signature verification failed: ${msg}`);
    }

    // 3. À ce stade, event est authentique et typé. On délègue le routage.
    await this.webhookService.handleEvent(event);

    // 4. Réponse 2xx rapide → Stripe marque l'event comme livré
    return { received: true };
  }
}
```

Points clés :
- `signature` est typé `string | undefined` — on gère explicitement l'absence.
- `constructEvent` est dans un `try/catch` : toute erreur = `400`, aucun traitement.
- On répond `{ received: true }` avec `@HttpCode(200)` seulement après délégation réussie.

### Exemple 2 — Routage idempotent des events (service)

```ts
// src/billing/stripe-webhook.service.ts
import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { UsersService } from '../users/users.service';
import { ProcessedEventsRepo } from './processed-events.repo';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly users: UsersService,
    private readonly processed: ProcessedEventsRepo,
  ) {}

  async handleEvent(event: Stripe.Event): Promise<void> {
    // --- Idempotence : a-t-on déjà traité cet event.id ? ---
    if (await this.processed.has(event.id)) {
      this.logger.log(`Event ${event.id} déjà traité — ignoré`);
      return;
    }

    // --- Routage : ne traiter QUE ce qu'on comprend ---
    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.onSubscriptionChanged(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_failed':
        await this.onPaymentFailed(event.data.object as Stripe.Invoice);
        break;

      // Tout le reste : on IGNORE (pas de throw) — Stripe envoie beaucoup d'events
      default:
        this.logger.debug(`Event non géré : ${event.type}`);
    }

    // --- Marquer comme traité APRÈS succès (idéalement même transaction que le métier) ---
    await this.processed.mark(event.id);
  }

  private async onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    // metadata.userId a été posé à la création de la session (module 02)
    const userId = session.metadata?.userId;
    const customerId = session.customer as string | null;
    if (!userId || !customerId) return; // rien à faire, on reste idempotent
    await this.users.attachStripeCustomer(userId, customerId);
  }

  private async onSubscriptionChanged(sub: Stripe.Subscription): Promise<void> {
    const user = await this.users.findByStripeCustomerId(sub.customer as string);
    if (!user) return; // user supprimé entre-temps → pas d'erreur (idempotence)

    // La source de vérité du tier = statut + price de l'abonnement
    const isActive = sub.status === 'active' || sub.status === 'trialing';
    await this.users.updateSubscription(user.id, {
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status, // 'trialing' | 'active' | 'past_due' | ...
      tier: isActive ? 'premium' : 'free',
    });
  }

  private async onSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
    const user = await this.users.findByStripeCustomerId(sub.customer as string);
    if (!user) return;
    // Retour en Free — la fin de période fine est gérée au module 04
    await this.users.updateSubscription(user.id, {
      subscriptionStatus: 'canceled',
      tier: 'free',
    });
  }

  private async onPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const user = await this.users.findByStripeCustomerId(invoice.customer as string);
    if (!user) return;
    // On NE coupe PAS Premium immédiatement : Stripe va retenter (dunning, module 07)
    await this.users.markPastDue(user.id);
  }
}
```

Ce qu'il illustre : idempotence en tête, `switch` qui ignore l'inconnu, `if (!user) return` partout (aucun event ne doit jamais throw sur un cas absent), et la décision du tier prise sur `subscription.status`.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Activer Premium sur le `success_url`

```ts
// ❌ Le success_url est côté navigateur : falsifiable, pas garanti, arrive pas si onglet fermé
if (searchParams.success) user.tier = 'premium';
```

Le retour navigateur sert à l'UX (« merci ! »). L'état payant se décide **exclusivement** sur les webhooks `customer.subscription.*`. C'est le piège #1 de tout le module — celui qui coûte de l'argent (Premium gratuit) ou des clients (payé, resté Free).

### PIÈGE #2 — Passer le JSON parsé à `constructEvent`

```ts
// ❌ req.body a été parsé par express.json() → octets modifiés → signature invalide
stripe.webhooks.constructEvent(req.body, sig, secret); // échoue TOUJOURS

// ✅ Passer le corps BRUT
stripe.webhooks.constructEvent(req.rawBody, sig, secret);
```

La signature porte sur les octets exacts. Toute re-sérialisation les change. Il faut `rawBody: true` dans `main.ts` et passer `req.rawBody`. Symptôme typique : « ça marche pas en local, signature toujours invalide » alors que le secret est bon.

### PIÈGE #3 — Sauter la vérification « juste pour tester »

```ts
// ❌ NE JAMAIS FAIRE ÇA — même 5 minutes, même en dev
const event = JSON.parse(req.body); // aucune vérification → endpoint ouvert à tous
```

Un endpoint qui `JSON.parse` sans `constructEvent` accepte n'importe quel POST forgé. En dev, on utilise `stripe listen` (Stripe CLI) qui fournit un vrai secret de test et de vraies signatures. La vérification reste active partout.

### PIÈGE #4 — Throw sur un event non géré

```ts
// ❌ Stripe envoie des dizaines de types ; throw → tu réponds 5xx → Stripe retente en boucle
default:
  throw new Error(`Unhandled event: ${event.type}`);

// ✅ Ignorer silencieusement l'inconnu
default:
  this.logger.debug(`Event non géré : ${event.type}`);
```

Un `throw` sur l'inconnu génère des 5xx en cascade et des retries Stripe inutiles. Le `default` doit **ignorer**, pas échouer.

### PIÈGE #5 — Oublier l'idempotence

```ts
// ❌ Sans check event.id : un retry réseau rejoue le traitement
//    → double email de bienvenue, double extension de période, double comptage
await this.processEvent(event);

// ✅ Vérifier event.id avant de traiter
if (await this.processed.has(event.id)) return;
await this.processEvent(event);
await this.processed.mark(event.id);
```

Stripe **garantit au moins une livraison**, pas exactement une. Sans idempotence, chaque retry rejoue les effets de bord. `event.id` est stable entre les tentatives : c'est la clé de déduplication.

### PIÈGE #6 — Confondre `invoice.paid` et `invoice.payment_succeeded`

L'event de succès de facture recommandé aujourd'hui est **`invoice.paid`**. `invoice.payment_succeeded` est un ancien alias qui existe encore. Écouter les deux fait traiter deux fois — d'où l'importance de l'idempotence — mais le nom courant à câbler est `invoice.paid`. Ne devine jamais : vérifie le nom exact sur `docs.stripe.com`.

---

## 5. Ancrage TribuZen

Le webhook est le **cœur du back-office billing TribuZen**. C'est lui, et lui seul, qui bascule une famille de Free à Premium.

Flux réel TribuZen Premium :

1. Un parent clique « Essayer 90 jours » → Checkout (module 02), avec `metadata.userId`.
2. Il paie. Stripe crée l'abonnement en `trialing`.
3. **Stripe POST `checkout.session.completed`** → TribuZen rattache le `stripeCustomerId` à l'utilisateur.
4. **Stripe POST `customer.subscription.created`** (`status: trialing`) → TribuZen passe la famille en **Premium**. *C'est ici que Premium s'active — pas au retour navigateur.*
5. 87 jours plus tard : `customer.subscription.trial_will_end` → email « ton essai expire dans 3 jours ».
6. Fin du trial, paiement OK : `invoice.paid` + `customer.subscription.updated` (`status: active`) → Premium maintenu.
7. Paiement KO : `invoice.payment_failed` → famille en `past_due`, relance (dunning, module 07). Premium n'est pas coupé tout de suite.
8. Annulation effective : `customer.subscription.deleted` → retour en Free.

Fichiers cibles dans `smaurier/tribuzen` :

```
tribuzen-api/
  src/
    main.ts                              ← rawBody: true
    billing/
      stripe-webhook.controller.ts       ← Exemple 1 (signature)
      stripe-webhook.service.ts          ← Exemple 2 (routage + idempotence)
      processed-events.repo.ts           ← table processed_webhook_events
```

> Le calcul fin du tier (`premium` vs `family`, proration, downgrade en fin de période) est approfondi au **module 04 (subscriptions et cycle de vie)**. Ici, on garantit que l'activation part *du webhook signé*.

---

## 6. Points clés

1. L'état payant se décide sur le **webhook signé**, jamais sur le `success_url` (falsifiable, pas garanti).
2. `stripe.webhooks.constructEvent(rawBody, signature, secret)` vérifie le header `Stripe-Signature` et retourne l'`Event` typé — ou throw si la signature est invalide.
3. Le **raw body** est obligatoire (`rawBody: true` dans `main.ts`) : la signature porte sur les octets exacts, un JSON re-sérialisé casse la vérification.
4. On route les events par `event.type` et on **ignore l'inconnu** dans le `default` (pas de throw → pas de 5xx / retries inutiles).
5. Events clés : `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`.
6. Stripe garantit **au moins une** livraison : l'idempotence via `event.id` déjà traité est indispensable pour éviter les effets de bord dupliqués.
7. L'endpoint webhook n'a **pas** d'auth JWT : la signature *est* l'authentification. Header absent ou signature invalide → `400`.
8. Le secret de signature (`whsec_...`) vit dans `.env`, jamais dans le code ni le repo.

---

## 7. Seeds Anki

```
Pourquoi ne jamais activer Premium sur le success_url ?|Le success_url est côté navigateur : falsifiable (URL visible/devinable), pas garanti (onglet fermé), et le paiement peut échouer après la redirection. L'état payant se décide sur le webhook signé.
Quels sont les 3 arguments de stripe.webhooks.constructEvent ?|(1) le rawBody brut de la requête, (2) la valeur du header stripe-signature, (3) le secret de signature whsec_... Il retourne l'Event typé ou throw si la signature est invalide.
Pourquoi faut-il le raw body pour vérifier un webhook Stripe ?|La signature est un HMAC calculé sur les octets exacts envoyés. Si express.json() parse puis re-sérialise le corps, les octets changent et constructEvent échoue toujours. D'où rawBody: true dans main.ts.
Que fait le default du switch dans un handler webhook ?|Il IGNORE l'event (log debug), sans throw. Stripe envoie des dizaines de types ; throw → réponse 5xx → Stripe retente en boucle inutilement.
Pourquoi un handler webhook doit-il être idempotent, et comment ?|Stripe garantit au moins une livraison, pas exactement une (retries jusqu'à 3 jours). On stocke les event.id déjà traités et on ignore un event déjà vu, sinon les effets de bord (emails, extensions de période) sont dupliqués.
Quel event Stripe utiliser pour un paiement de facture réussi ?|invoice.paid (nom courant). invoice.payment_succeeded est un ancien alias qui existe encore. Toujours vérifier le nom exact sur docs.stripe.com, ne jamais deviner.
Faut-il mettre un JwtAuthGuard sur la route webhook Stripe ?|Non. L'appelant est Stripe, pas un utilisateur connecté. La vérification de signature EST l'authentification. Header stripe-signature absent ou invalide → 400.
Quel event active concrètement Premium dans TribuZen ?|customer.subscription.created/updated avec status trialing ou active : c'est le point de vérité du tier. checkout.session.completed sert surtout à rattacher le stripeCustomerId à l'utilisateur.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-03-webhooks-et-idempotence/README.md`. Construire un handler webhook NestJS signé et idempotent, testé en local avec `stripe listen` (Stripe CLI) — vrai SDK Stripe en mode test, zéro harnais simulé, corrigé complet commenté.
