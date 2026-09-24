# 22 — Stripe Billing

![VitePress](https://img.shields.io/badge/-VitePress-646CFF?style=flat-square&logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
[![fullstack-autotraining](https://img.shields.io/badge/curriculum-fullstack--autotraining-4C1?style=flat-square)](https://github.com/smaurier/fullstack-autotraining)

> **Prérequis** : NestJS (cours 04) + PostgreSQL (cours 05) + AWS (cours 15).

Cours ajouté pour le modèle freemium TribuZen — compétence indispensable sur toute mission SaaS.

<!-- labs-gestes:start -->
## Labs — refonte du 22/09/2026 : un lab = un geste métier complet

> Règle qualité 5 du parcours : chaque lab est **un geste métier complet**, sous deux formes — **Zéro** (construire de zéro un artefact réel et entier) ou **Intervention** (modifier de l'existant avec consommateurs, findings avant code, non-régression). Un lab n'entre en file qu'avec un **oracle exécutable** (`src/` starter · `test/` · `solution/` séparée). Les labs historiques de ce cours (un concept par lab, sans oracle) restent dans `labs/` jusqu'à remplacement et **ne sont plus la file**. Cible détaillée : [`docs/gestes-complets.md`](../docs/gestes-complets.md). État : **2/2 avec oracle**.

| # | Lab | Forme | Geste | Oracle |
|---|-----|-------|-------|--------|
| 01 | [`lab-01-freemium-de-zero`](labs/lab-01-freemium-de-zero/README.md) | Zéro | Checkout, webhook signé, gate NestJS, portail | ✅ vérifié |
| 02 | [`lab-02-webhook-perdu`](labs/lab-02-webhook-perdu/README.md) | Intervention | rejouer, idempotence | ✅ vérifié |

<!-- labs-gestes:end -->

## Modules

| # | Module | Durée |
|---|--------|-------|
| 01 | [Modèles de facturation & Stripe Products](modules/01-stripe-products.md) | 45 min |
| 02 | [Stripe Checkout](modules/02-stripe-checkout.md) | 60 min |
| 03 | [Webhooks NestJS](modules/03-webhooks-nestjs.md) | 75 min |
| 04 | [Customer Portal](modules/04-customer-portal.md) | 45 min |
| 05 | [Freemium gates & Guards NestJS](modules/05-freemium-gates.md) | 60 min |
| 06 | [Légalité FR & RGPD Stripe](modules/06-legalite.md) | 30 min |

## TribuZen deliverables

- Trial 90 jours → conversion premium avec webhook
- Guard NestJS vérifiant le tier (free/premium/family)
- Gate sur : co-parentalité bridge, livre annuel, routines illimitées
- Pricing ancré (plan annuel 59€ affiché en premier)
- Email fin de trial avec loss aversion (Kahneman & Tversky 1979)
