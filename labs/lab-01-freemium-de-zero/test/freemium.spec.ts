import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { InvalidSignatureError, verifyStripeSignature } from "@lab/stripeWebhook";
import {
  NoActiveSubscriptionError,
  SubscriptionGuard,
  SubscriptionStore,
  applyStripeEvent,
  getPortalUrl,
  type PortalPort,
  type StripeEvent,
} from "@lab/subscriptionGate";

const SECRET = "whsec_lab_test_secret";

// Signe un payload EXACTEMENT comme Stripe le ferait, indépendamment de l'implémentation du
// lab — sert de vecteur de test, pas de raccourci.
function signer(rawBody: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
  const signedPayload = `${timestamp}.${rawBody}`;
  const hmac = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

describe("verifyStripeSignature — vraie vérification HMAC, sans appel réseau", () => {
  it("accepte une signature réellement valide", () => {
    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
    expect(() => verifyStripeSignature(body, signer(body), SECRET)).not.toThrow();
  });

  it("rejette un payload altéré après signature", () => {
    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
    const header = signer(body);
    const altere = body.replace("evt_1", "evt_2");
    expect(() => verifyStripeSignature(altere, header, SECRET)).toThrow(InvalidSignatureError);
  });

  it("rejette une signature calculée avec le mauvais secret webhook", () => {
    const body = JSON.stringify({ id: "evt_1" });
    const header = signer(body, "whsec_mauvais_secret");
    expect(() => verifyStripeSignature(body, header, SECRET)).toThrow(InvalidSignatureError);
  });

  it("rejette un en-tête malformé (pas de t= ou v1=)", () => {
    expect(() => verifyStripeSignature("{}", "n-importe-quoi", SECRET)).toThrow(InvalidSignatureError);
  });
});

describe("verifyStripeSignature — comparaison en temps constant (relecture du source)", () => {
  it("utilise timingSafeEqual, pas une comparaison directe du secret dérivé", () => {
    const rawSource = readFileSync(process.env.LAB_ROOT + "/stripeWebhook.ts", "utf8");
    const source = rawSource
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");

    expect(source).toMatch(/timingSafeEqual/);
    expect(source).not.toMatch(/expected\s*!==\s*provided|provided\s*!==\s*expected/);
  });
});

function evenement(type: string, customer: string, id = "evt_" + Math.random()): StripeEvent {
  return { id, type, data: { object: { customer } } };
}

describe("applyStripeEvent + SubscriptionGuard — le geste freemium de bout en bout", () => {
  it("un client sans webhook reçu n'a PAS accès", () => {
    const store = new SubscriptionStore();
    const guard = new SubscriptionGuard(store);
    expect(guard.canActivate("cus_alice")).toBe(false);
  });

  it("checkout.session.completed active l'accès", () => {
    const store = new SubscriptionStore();
    applyStripeEvent(evenement("checkout.session.completed", "cus_alice"), store);
    const guard = new SubscriptionGuard(store);
    expect(guard.canActivate("cus_alice")).toBe(true);
  });

  it("un événement d'un AUTRE type n'a aucun effet", () => {
    const store = new SubscriptionStore();
    applyStripeEvent(evenement("invoice.payment_failed", "cus_alice"), store);
    expect(new SubscriptionGuard(store).canActivate("cus_alice")).toBe(false);
  });

  it("customer.subscription.deleted révoque un accès précédemment activé", () => {
    const store = new SubscriptionStore();
    applyStripeEvent(evenement("checkout.session.completed", "cus_alice"), store);
    applyStripeEvent(evenement("customer.subscription.deleted", "cus_alice"), store);
    expect(new SubscriptionGuard(store).canActivate("cus_alice")).toBe(false);
  });

  it("l'activation d'un client n'accorde PAS l'accès à un autre", () => {
    const store = new SubscriptionStore();
    applyStripeEvent(evenement("checkout.session.completed", "cus_alice"), store);
    expect(new SubscriptionGuard(store).canActivate("cus_bob")).toBe(false);
  });
});

describe("getPortalUrl — jamais de lien portail sans abonnement actif", () => {
  it("refuse un client freemium SANS appeler le port (aucune session portail créée)", () => {
    const store = new SubscriptionStore();
    const port: PortalPort = { createPortalSession: vi.fn(() => "https://billing.stripe.com/session/xyz") };
    expect(() => getPortalUrl("cus_alice", store, port)).toThrow(NoActiveSubscriptionError);
    expect(port.createPortalSession).not.toHaveBeenCalled();
  });

  it("retourne l'URL du port pour un client abonné", () => {
    const store = new SubscriptionStore();
    applyStripeEvent(evenement("checkout.session.completed", "cus_alice"), store);
    const port: PortalPort = { createPortalSession: vi.fn(() => "https://billing.stripe.com/session/xyz") };
    expect(getPortalUrl("cus_alice", store, port)).toBe("https://billing.stripe.com/session/xyz");
    expect(port.createPortalSession).toHaveBeenCalledWith("cus_alice");
  });
});
