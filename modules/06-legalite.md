# Module 06 — Légalité FR & RGPD Stripe

| Difficulté | Durée estimée |
|------------|---------------|
| 2/5        | 30 min        |

## Objectifs
- Connaître les obligations légales autour du paiement en France
- Comprendre le DPA Stripe (sous-traitant RGPD)
- Configurer les factures automatiques
- Comprendre ce qu'il ne faut pas faire soi-même

---

## Obligations légales paiement (France)

```
1. Factures automatiques
   → Stripe génère des factures PDF pour chaque paiement
   → Obligation légale : numéro séquentiel, date, montant TTC, TVA, SIREN vendeur
   → Configuration Dashboard → Settings → Billing → Invoice template

2. Mentions légales paiement
   → Sur la page pricing : "Paiement sécurisé par Stripe"
   → CGV/CGU doivent mentionner Stripe comme sous-traitant de paiement

3. Remboursement
   → Délai légal 14 jours (droit de rétractation e-commerce)
   → Stripe Dashboard → Payment → Refund (manuel)
   → Pour V1 : traiter manuellement, automatiser en V2

4. TVA
   → En dessous du seuil TVA (34 400€ CA) : exonéré
   → Au-dessus : collecter et reverser la TVA via Stripe Tax (activer dans Dashboard)
```

---

## DPA Stripe — sous-traitant RGPD

```
Stripe traite les données de paiement de tes utilisateurs.
Ils sont sous-traitants RGPD → DPA obligatoire.

Où signer le DPA Stripe :
  Dashboard → Settings → Team & security → Data Processing Agreement
  → Accepter le DPA standard (auto-signé numériquement)

Ce que le DPA couvre :
  ├── Stripe traite uniquement pour les finalités que tu définis
  ├── Stripe est certifié PCI-DSS Level 1
  ├── Données stockées dans des datacenters certifiés (EU disponible)
  ├── Droit à l'effacement : Stripe supprime sur demande
  └── Breach notification : Stripe t'informe en < 72h si incident

⚠️ Pour TribuZen : activer le stockage EU dans Stripe Dashboard
   Dashboard → Settings → Data privacy → Data location → Europe
```

---

## Configuration factures automatiques

```typescript
// Dans la session Checkout : activer les factures
const session = await stripe.checkout.sessions.create({
  // ...
  invoice_creation: {
    enabled: true,
    invoice_data: {
      description: 'Abonnement TribuZen Premium',
      footer: 'TribuZen SAS — SIREN: XXX XXX XXX',
      rendering_options: { amount_tax_display: 'include_inclusive_tax' },
    },
  },
});
```

```
Dashboard Stripe → Settings → Billing → Customer emails
  ✅ Successful payments (confirmation de paiement)
  ✅ Failed payments (relance automatique)
  ✅ Upcoming renewals (7 jours avant)
  ✅ Subscription cancellation
```

---

## Ce que tu ne dois PAS gérer toi-même

```
❌ Stocker les numéros de carte → Stripe le fait (PCI-DSS)
❌ Chiffrer les données de paiement → Stripe le fait
❌ Gérer les tentatives de relance → Stripe Dunning Management le fait
❌ Émettre les factures légalement conformes → Stripe le fait
❌ Gérer le 3DS (authentification forte) → Stripe le gère automatiquement
```

---

## Checklist

- [ ] DPA Stripe signé dans le Dashboard
- [ ] Stockage de données localisé EU dans les paramètres Stripe
- [ ] Factures automatiques activées avec SIREN dans le footer
- [ ] Emails automatiques Stripe activés (confirmation, relance, renouvellement)
- [ ] La politique de confidentialité TribuZen mentionne Stripe comme sous-traitant
- [ ] Le droit de rétractation 14 jours est mentionné dans les CGV
