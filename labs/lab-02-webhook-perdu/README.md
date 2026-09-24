# Lab 02 — Intervention : le webhook rejoué qui a doublé un crédit

> **Outcome :** à la fin, un webhook Stripe REJOUÉ (Stripe retente automatiquement si ton
> serveur était down, ou un opérateur le renvoie manuellement depuis le dashboard — les
> deux sont réels, module 03) n'a PLUS aucun effet la seconde fois : l'idempotence est par
> `event.id`, pas par client ni par montant.
> **Vrai outil :** un `CreditsWallet` réel (donné, hors `src/`), un test qui REJOUE
> littéralement le même événement plusieurs fois et mesure le solde final.
> **Feedback :** `npm run lab:02` — RED sur l'incident réel (double crédit reproduit).
> `npm run solution:02` prouve l'oracle (5 tests).

## Prérequis technique

Aucune dépendance externe, aucune clé API. `npm install` depuis `22-stripe-billing/labs`.

## Lire avant (une lecture bornée)

- Module [`03-webhooks-et-idempotence.md`](../../modules/03-webhooks-et-idempotence.md) —
  pourquoi Stripe REJOUE des webhooks (design du système, pas un bug de Stripe), et comment
  s'en protéger par un id d'événement.

## Énoncé

Incident rapporté : « un client s'est plaint d'avoir reçu deux fois ses crédits sur la même
facture. » `src/processInvoicePaid.ts` COMPILE et MARCHE dans le cas simple — le bug
n'apparaît QUE quand le même `event.id` arrive une seconde fois.

**AVANT de corriger : ouvre `src/processInvoicePaid.ts`, lis les commentaires en tête.**

Corrige la fonction pour qu'un `event.id` déjà traité (présent dans `dejaTraites`) soit un
no-op complet — aucun crédit, aucun effet — tout en laissant un `event.id` nouveau créditer
normalement et se marquer comme traité.

**Le piège à éviter.** Dédupliquer par CLIENT (« ce client a déjà reçu un crédit
aujourd'hui ») bloquerait à tort une DEUXIÈME facture légitime du même client. La clé
d'idempotence est l'identifiant unique de l'ÉVÉNEMENT, pas du client ni du montant.

## Vérifier

```bash
cd 22-stripe-billing/labs
npm run lab:02
npm run solution:02
```

## Ce que l'oracle vérifie

Un premier événement crédite normalement ; le MÊME événement rejoué une deuxième puis une
troisième fois n'ajoute rien ; une facture DIFFÉRENTE (id différent) du même client crédite
normalement en plus ; le rejeu d'un événement d'un autre client ne touche pas le solde du
premier.

## Variante J+30 (fading)

Deux événements DIFFÉRENTS mais avec le MÊME montant (pas le même id) doivent tous les deux
créditer — prouve que la déduplication n'utilise jamais le montant comme heuristique.

## Application TribuZen

Même geste sur `tribuzen-api` : le handler webhook réel doit survivre à un redémarrage de
serveur pendant qu'un webhook est en vol (Stripe le retente automatiquement), sans jamais
créditer deux fois. Commit :
`fix(billing): idempotence par event.id, rejeu de webhook sans double effet`.
