// processInvoicePaid.ts — L'EXISTANT, EN PRODUCTION. Incident rapporté : « un client s'est
// plaint d'avoir reçu DEUX FOIS ses crédits sur la même facture. » Ce fichier COMPILE et
// MARCHE dans le cas simple (un événement, une fois) — le bug n'apparaît QUE quand Stripe
// REJOUE un webhook déjà traité : le serveur était down au premier envoi, Stripe retente
// automatiquement (comportement RÉEL, documenté module 03) ou un opérateur le renvoie
// manuellement depuis le dashboard — dans les deux cas, le MÊME `event.id` arrive une
// seconde fois.
//
// Contrat à respecter (signature inchangée) :
//   processInvoicePaid(event: InvoicePaidEvent, wallet: CreditsWallet, dejaTraites: Set<string>): void
//     - Crédite `wallet` du montant payé, comme aujourd'hui.
//     - MAIS si `event.id` a déjà été traité (présent dans `dejaTraites`), l'appel ne doit
//       avoir AUCUN effet (ni crédit, ni ajout) — un rejeu doit être un no-op, pas une
//       deuxième récompense.
//     - Un événement avec un `id` JAMAIS vu doit, lui, créditer normalement ET marquer son
//       `id` comme traité (pour bloquer un futur rejeu).
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
  wallet.crediter(event.data.object.customer, event.data.object.amount_paid);
}
