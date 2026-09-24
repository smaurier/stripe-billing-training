// subscriptionGate.ts — PAGE BLANCHE. Le geste complet : un webhook Stripe VÉRIFIÉ (module
// `stripeWebhook.ts`, déjà fait) fait passer un client de "freemium" à "abonné", une garde
// NestJS bloque l'accès aux clients non abonnés, et le lien du Customer Portal n'est JAMAIS
// généré pour un client sans abonnement actif (module `05-customer-portal-et-self-service`).
//
// Aucun appel réseau réel vers Stripe dans ce lab (pas de clé de test fournie) : la création
// de session Checkout/portail est derrière un PORT (`PortalPort`), comme l'architecture
// hexagonale du cours 13 — le geste testé est la RÈGLE MÉTIER (qui a accès à quoi), pas le
// SDK Stripe lui-même.
//
// export type StripeEvent = { id: string; type: string; data: { object: { customer: string } } }
//
// export class SubscriptionStore
//   - `activer(customerId)`, `revoquer(customerId)`, `estActif(customerId): boolean`.
//
// export function applyStripeEvent(event: StripeEvent, store: SubscriptionStore): void
//   - `"checkout.session.completed"` → active l'abonnement du client de l'événement.
//   - `"customer.subscription.deleted"` → le révoque.
//   - tout autre type d'événement : ignoré (pas d'erreur, pas d'effet).
//
// export class SubscriptionGuard
//   - constructeur `(store: SubscriptionStore)`.
//   - `canActivate(customerId: string): boolean` — modelé sur le contrat `CanActivate` de
//     NestJS. `true` si et seulement si le client a un abonnement actif.
//
// export interface PortalPort { createPortalSession(customerId: string): string }
// export function getPortalUrl(customerId: string, store: SubscriptionStore, portal: PortalPort): string
//   - Si le client n'a PAS d'abonnement actif : lève `NoActiveSubscriptionError` (exportée)
//     SANS appeler `portal.createPortalSession` (le port ne doit jamais être sollicité pour
//     un client non éligible).
//   - Sinon : retourne `portal.createPortalSession(customerId)`.

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: { customer: string; [key: string]: unknown } };
};

export class NoActiveSubscriptionError extends Error {}

export interface PortalPort {
  createPortalSession(customerId: string): string;
}

export class SubscriptionStore {
  activer(_customerId: string): void {
    throw new Error("SubscriptionStore.activer n'est pas encore implémenté");
  }
  revoquer(_customerId: string): void {
    throw new Error("SubscriptionStore.revoquer n'est pas encore implémenté");
  }
  estActif(_customerId: string): boolean {
    throw new Error("SubscriptionStore.estActif n'est pas encore implémenté");
  }
}

export function applyStripeEvent(_event: StripeEvent, _store: SubscriptionStore): void {
  throw new Error("applyStripeEvent n'est pas encore implémenté");
}

export class SubscriptionGuard {
  constructor(private readonly store: SubscriptionStore) {}
  canActivate(_customerId: string): boolean {
    throw new Error("SubscriptionGuard.canActivate n'est pas encore implémenté");
  }
}

export function getPortalUrl(_customerId: string, _store: SubscriptionStore, _portal: PortalPort): string {
  throw new Error("getPortalUrl n'est pas encore implémenté");
}
