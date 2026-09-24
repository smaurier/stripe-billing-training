// subscriptionGate.ts — SOLUTION DE RÉFÉRENCE (commentée). Ne l'ouvre pas avant ton GREEN.

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: { customer: string; [key: string]: unknown } };
};

export class SubscriptionStore {
  private readonly actifs = new Set<string>();

  activer(customerId: string): void {
    this.actifs.add(customerId);
  }

  revoquer(customerId: string): void {
    this.actifs.delete(customerId);
  }

  estActif(customerId: string): boolean {
    return this.actifs.has(customerId);
  }
}

// L'abonnement démarre à `checkout.session.completed` (paiement confirmé côté Stripe) et se
// termine à `customer.subscription.deleted` (résiliation, fin de période, échec définitif).
// Les autres types d'événements sont ignorés — un webhook Stripe reçoit BEAUCOUP plus
// d'événements que ceux qui nous intéressent, il faut trier.
export function applyStripeEvent(event: StripeEvent, store: SubscriptionStore): void {
  switch (event.type) {
    case "checkout.session.completed":
      store.activer(event.data.object.customer);
      break;
    case "customer.subscription.deleted":
      store.revoquer(event.data.object.customer);
      break;
  }
}

// Modelé sur le contrat `CanActivate` de NestJS (`canActivate(context): boolean`) — un vrai
// Guard NestJS enveloppe ceci dans `ExecutionContext`, mais la décision métier testée ici
// (abonné ou pas) ne dépend d'aucun détail HTTP.
export class SubscriptionGuard {
  constructor(private readonly store: SubscriptionStore) {}

  canActivate(customerId: string): boolean {
    return this.store.estActif(customerId);
  }
}

export class NoActiveSubscriptionError extends Error {}

export interface PortalPort {
  createPortalSession(customerId: string): string;
}

// Le lien vers le Customer Portal ne doit JAMAIS être généré pour un client sans abonnement
// actif — sinon un client freemium pourrait gérer un abonnement qui n'existe pas. Le port
// n'est appelé QU'APRÈS validation, jamais avant (testé en espionnant l'appel).
export function getPortalUrl(customerId: string, store: SubscriptionStore, portal: PortalPort): string {
  if (!store.estActif(customerId)) {
    throw new NoActiveSubscriptionError(`aucun abonnement actif pour ${customerId}`);
  }
  return portal.createPortalSession(customerId);
}
