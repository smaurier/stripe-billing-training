# Lab 01 — Zéro : le geste freemium de bout en bout

> **Outcome :** à la fin, un webhook Stripe RÉELLEMENT signé (vrai HMAC-SHA256, vérifié en
> local, aucun appel réseau) fait passer un client de « freemium » à « abonné », une garde
> modelée sur `CanActivate` de NestJS bloque l'accès aux non-abonnés, et le lien du Customer
> Portal n'est JAMAIS généré pour un client sans abonnement actif.
> **Vrai outil :** l'algorithme de signature Stripe RÉEL (`node:crypto`, HMAC-SHA256 sur
> `${timestamp}.${payload}`, comparaison `timingSafeEqual`) — le même calcul que fait Stripe,
> sans jamais appeler `stripe.com`.
> **Feedback :** `npm run lab:01` — RED tant que `src/` ne satisfait pas l'oracle.
> `npm run solution:01` prouve l'oracle (12 tests).

## Ce qui n'est PAS testé ici (limite assumée, documentée honnêtement)

Aucune clé Stripe de test n'est fournie à ce cours : créer une VRAIE session Checkout ou un
VRAI lien de Customer Portal nécessite un compte Stripe réel (mode test, gratuit, mais un
compte quand même) et un appel réseau — hors de portée d'un oracle qui doit tourner sans
identifiants, à l'identique de la limite déjà posée sur AWS. Le port `PortalPort` (module
13 — architecture hexagonale) isole ce point : le geste TESTÉ ici est la RÈGLE MÉTIER (qui a
le droit d'obtenir un lien), pas le SDK Stripe lui-même. En conditions réelles, tu
brancherais `PortalPort` sur `stripe.billingPortal.sessions.create(...)`.

## Prérequis technique

Aucune dépendance externe, aucune clé API. `npm install` depuis `22-stripe-billing/labs`.

## Lire avant (une lecture bornée)

- Module [`03-webhooks-et-idempotence.md`](../../modules/03-webhooks-et-idempotence.md) —
  comment Stripe signe un webhook, pourquoi le timestamp fait partie du payload signé.
- Module [`06-freemium-et-feature-gating.md`](../../modules/06-freemium-et-feature-gating.md)
  — gating d'accès par statut d'abonnement.
- Module [`05-customer-portal-et-self-service.md`](../../modules/05-customer-portal-et-self-service.md)
  — pourquoi le lien du portail ne doit jamais être généré sans vérification préalable.

## Énoncé

Trois briques à construire dans `src/` :

1. **`stripeWebhook.ts`** — `verifyStripeSignature(rawBody, signatureHeader, secret)` :
   recalcule le HMAC attendu et compare en temps constant. Lève `InvalidSignatureError` si
   l'en-tête est malformé ou si la signature ne correspond pas.
2. **`subscriptionGate.ts` (événements)** — `applyStripeEvent` fait passer un client de
   freemium à abonné sur `checkout.session.completed`, le repasse à freemium sur
   `customer.subscription.deleted`. Les autres types d'événements sont ignorés.
3. **`subscriptionGate.ts` (accès)** — `SubscriptionGuard.canActivate(customerId)` renvoie
   `true` seulement pour un abonné actif ; `getPortalUrl` refuse tout client non éligible
   AVANT d'appeler le port (vérifié en espionnant l'appel).

**Le piège à éviter.** Le payload signé par Stripe n'est PAS le corps brut seul — c'est
`${timestamp}.${corpsBrut}`. Signer/vérifier seulement le corps donnerait une signature qui
ne correspond JAMAIS à ce qu'envoie réellement Stripe.

## Vérifier

```bash
cd 22-stripe-billing/labs
npm run lab:01
npm run solution:01
```

## Ce que l'oracle vérifie

Signature réelle acceptée ; payload altéré après signature rejeté ; mauvais secret rejeté ;
en-tête malformé rejeté ; comparaison en temps constant (relecture du source, même limite
de mesure que le lab 04 de Sécurité applicative — le timing n'est pas fiable à mesurer, la
preuve est une relecture honnêtement documentée comme telle) ; activation/révocation
d'accès par événement, événements non pertinents ignorés, isolation entre clients ; lien de
portail refusé SANS appel au port pour un non-abonné, retourné pour un abonné.

## Variante J+30 (fading)

Un événement `customer.subscription.updated` avec `status: "past_due"` doit lui aussi
couper l'accès (pas seulement `.deleted`) — sans toucher à la structure déjà en place.

## Application TribuZen

Même geste sur `tribuzen-api` : un plan payant réel (fonctions IA, export PDF illimité)
gaté par un VRAI webhook Stripe signé, jamais par un flag client-side falsifiable. Commit :
`feat(billing): geste freemium complet, webhook signé vérifié en local`.
