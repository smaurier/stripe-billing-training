// stripeWebhook.ts — PAGE BLANCHE. Vérifie la signature d'un webhook Stripe SANS appel
// réseau : Stripe signe chaque webhook avec un HMAC-SHA256 du payload, que tu peux
// recalculer et comparer toi-même (module 03, "webhooks-et-idempotence").
//
// L'en-tête `Stripe-Signature` a la forme : `t=<timestamp>,v1=<hex hmac>`.
// Le payload RÉELLEMENT signé n'est PAS `rawBody` seul, c'est `${timestamp}.${rawBody}`
// (le timestamp fait partie de la signature — ça protège aussi contre le rejeu d'un vieux
// payload avec une signature volée).
//
// export function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string): void
//   - Recalcule le HMAC-SHA256 attendu avec `secret` sur `${timestamp}.${rawBody}` (module
//     `node:crypto`, `createHmac("sha256", secret)`).
//   - Compare le résultat à `v1` en TEMPS CONSTANT (`timingSafeEqual`, jamais `===`/`!==`
//     sur un secret dérivé — même règle que le lab 04 de Sécurité applicative).
//   - Si l'en-tête est malformé OU si la signature ne correspond pas : lève une
//     `InvalidSignatureError` (exportée). Sinon : ne retourne rien (pas d'exception = signature
//     valide).
export class InvalidSignatureError extends Error {}

export function verifyStripeSignature(_rawBody: string, _signatureHeader: string, _secret: string): void {
  throw new Error("verifyStripeSignature n'est pas encore implémenté");
}
