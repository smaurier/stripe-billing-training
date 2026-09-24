// stripeWebhook.ts — SOLUTION DE RÉFÉRENCE (commentée). Ne l'ouvre pas avant ton GREEN.
import { createHmac, timingSafeEqual } from "node:crypto";

export class InvalidSignatureError extends Error {}

// Reproduit le VRAI schéma de signature Stripe (documenté publiquement) :
// l'en-tête `Stripe-Signature` a la forme `t=<timestamp>,v1=<hex hmac>` ; le payload signé
// est `${timestamp}.${corpsBrut}` ; le HMAC est SHA-256, avec le secret webhook. Aucun appel
// réseau — tout est vérifiable en local, avec les MÊMES calculs que ferait Stripe.
export function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string): void {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k, v];
    }),
  );
  const timestamp = parts.t;
  const provided = parts.v1;
  if (!timestamp || !provided) {
    throw new InvalidSignatureError("en-tête Stripe-Signature malformé");
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");

  // Comparaison en temps constant : jamais `===`/`!==` sur un secret dérivé (A02, même
  // discipline que SessionToken au lab 04 de Sécurité applicative).
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    throw new InvalidSignatureError("signature invalide : le payload ou le secret ne correspond pas");
  }
}
