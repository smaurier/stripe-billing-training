import { describe, expect, it } from "vitest";
import { processInvoicePaid, type InvoicePaidEvent } from "@lab/processInvoicePaid";
import { CreditsWallet } from "../CreditsWallet";

function facture(id: string, customer: string, amount_paid: number): InvoicePaidEvent {
  return { id, type: "invoice.paid", data: { object: { customer, amount_paid } } };
}

describe("processInvoicePaid — le geste réel : Stripe REJOUE un webhook déjà traité", () => {
  it("un premier événement crédite normalement le client", () => {
    const wallet = new CreditsWallet();
    const dejaTraites = new Set<string>();
    processInvoicePaid(facture("evt_100", "cus_alice", 50), wallet, dejaTraites);
    expect(wallet.solde("cus_alice")).toBe(50);
  });

  it("le MÊME événement rejoué (id identique) n'ajoute rien une seconde fois", () => {
    const wallet = new CreditsWallet();
    const dejaTraites = new Set<string>();
    const evt = facture("evt_100", "cus_alice", 50);
    processInvoicePaid(evt, wallet, dejaTraites);
    processInvoicePaid(evt, wallet, dejaTraites); // Stripe retente / rejeu manuel dashboard
    expect(wallet.solde("cus_alice")).toBe(50);
  });

  it("rejoué une TROISIÈME fois, toujours aucun effet", () => {
    const wallet = new CreditsWallet();
    const dejaTraites = new Set<string>();
    const evt = facture("evt_100", "cus_alice", 50);
    processInvoicePaid(evt, wallet, dejaTraites);
    processInvoicePaid(evt, wallet, dejaTraites);
    processInvoicePaid(evt, wallet, dejaTraites);
    expect(wallet.solde("cus_alice")).toBe(50);
  });

  it("une facture DIFFÉRENTE (id différent) pour le même client crédite normalement en plus", () => {
    const wallet = new CreditsWallet();
    const dejaTraites = new Set<string>();
    processInvoicePaid(facture("evt_100", "cus_alice", 50), wallet, dejaTraites);
    processInvoicePaid(facture("evt_101", "cus_alice", 30), wallet, dejaTraites);
    expect(wallet.solde("cus_alice")).toBe(80);
  });

  it("le rejeu d'un id d'un AUTRE client ne touche pas le solde du premier", () => {
    const wallet = new CreditsWallet();
    const dejaTraites = new Set<string>();
    processInvoicePaid(facture("evt_100", "cus_alice", 50), wallet, dejaTraites);
    processInvoicePaid(facture("evt_200", "cus_bob", 20), wallet, dejaTraites);
    expect(wallet.solde("cus_alice")).toBe(50);
    expect(wallet.solde("cus_bob")).toBe(20);
  });
});
