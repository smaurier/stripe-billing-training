# 22 — Stripe Billing

![VitePress](https://img.shields.io/badge/-VitePress-646CFF?style=flat-square&logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
[![fullstack-autotraining](https://img.shields.io/badge/curriculum-fullstack--autotraining-4C1?style=flat-square)](https://github.com/smaurier/fullstack-autotraining)

> **Prérequis** : NestJS (cours 04) + PostgreSQL (cours 05) + AWS (cours 15).

Cours ajouté pour le modèle freemium TribuZen — compétence indispensable sur toute mission SaaS.

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
