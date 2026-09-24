// processInvoicePaid.ts — SOLUTION DE RÉFÉRENCE (commentée). Ne l'ouvre pas avant ton GREEN.
import { CreditsWallet } from "../CreditsWallet";

export type InvoicePaidEvent = {
  id: string;
  type: "invoice.paid";
  data: { object: { customer: string; amount_paid: number } };
};

export function processInvoicePaid(
  event: InvoicePaidEvent,
  wallet: CreditsWallet,
  dejaTraites: Set<string>,
): void {
  // L'idempotence se fait par `event.id`, PAS par contenu ni par client : deux factures
  // différentes du même client doivent toutes les deux créditer, mais la MÊME facture
  // rejouée ne doit créditer qu'une fois. Vérifier AVANT de créditer, marquer APRÈS —
  // jamais l'inverse (sinon une erreur entre les deux laisserait un id marqué sans crédit).
  if (dejaTraites.has(event.id)) {
    return;
  }
  wallet.crediter(event.data.object.customer, event.data.object.amount_paid);
  dejaTraites.add(event.id);
}
