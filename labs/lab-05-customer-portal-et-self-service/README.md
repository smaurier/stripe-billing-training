# Lab 05 — Customer Portal et self-service

> **Outcome :** à la fin, tu sais exposer un endpoint NestJS `POST /billing/portal` qui ouvre le **Billing Customer Portal** Stripe pour une famille TribuZen et la redirige, avec le vrai SDK Stripe en mode test et un portail configuré dans le Dashboard.
> **Vrai outil :** SDK `stripe` (Node) en **mode test** + Dashboard Stripe (configuration du portail) + Stripe CLI (`stripe listen`) pour observer les webhooks déclenchés. JAMAIS un harnais simulé.
> **Feedback :** le coach valide en session (pas de test-runner auto-correcteur).

---

## Prérequis (mode test, clés jamais commitées)

- Un compte Stripe en **mode test**, un Produit + Price « TribuZen Premium » (lab 01) et au moins un Customer avec un abonnement `active` ou `trialing` (créé via le Checkout du lab 02, ou manuellement dans le Dashboard test).
- Les clés vivent dans `.env` (jamais commité), sous forme de placeholders dans cette doc :

```txt
# .env — NE JAMAIS COMMITTER (ajoute .env au .gitignore)
STRIPE_SECRET_KEY=sk_test_<CLE-EXEMPLE-NE-JAMAIS-COMMITTER>
APP_URL=http://localhost:5173
```

> ⚠️ Ne copie jamais une vraie clé dans un fichier suivi par git. GitHub bloque le push d'une clé `sk_test_...` réelle.

---

## Énoncé

Tu construis l'**unique** point d'entrée de gestion d'abonnement côté famille TribuZen : un endpoint qui ouvre le Customer Portal. Le cahier des charges **exact** :

1. **Configurer le portail dans le Dashboard test** (`Settings → Billing → Customer portal`) : activer le changement de plan, la mise à jour du moyen de paiement, l'annulation **en fin de période**, l'historique des factures. Définir un return URL par défaut.
2. **Endpoint `POST /billing/portal`** protégé par `JwtAuthGuard` : il ouvre une session de portail pour le client connecté et renvoie `{ url }`.
3. **Service `createPortalSession(user)`** : garde-fou `stripeCustomerId`, appel `billingPortal.sessions.create({ customer, return_url })`, retour de `session.url`.
4. **Vérifier de bout en bout** : le front (ou un `curl`) reçoit une URL Stripe, tu l'ouvres, tu changes de plan / annules, et tu observes le webhook `customer.subscription.updated` (ou `.deleted`) arriver via `stripe listen`.

**Pas de gap-fill** — tu écris le controller et le service complets à partir du starter minimal.

### Starter minimal

```ts
// src/billing/billing.controller.ts — starter
import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../users/user.entity';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // À écrire : POST /billing/portal, protégé JWT, retourne { url }
}
```

```ts
// src/billing/billing.service.ts — starter
import { Injectable, Inject } from '@nestjs/common';
import Stripe from 'stripe';
import type { User } from '../users/user.entity';

@Injectable()
export class BillingService {
  constructor(@Inject('STRIPE_CLIENT') private readonly stripe: Stripe) {}

  // À écrire : createPortalSession(user) → string (session.url)
  // - garde-fou : user.stripeCustomerId doit exister
  // - billingPortal.sessions.create({ customer, return_url })
}
```

---

## Étapes (en friction)

1. **Configure le portail dans le Dashboard test** avant tout code — sinon `sessions.create` échoue avec une erreur de configuration. Note quelles features tu actives.
2. **Écris le garde-fou** dans `createPortalSession` : si `user.stripeCustomerId` est absent, lève une `BadRequestException` explicite (un Free n'a pas de `cus_...`).
3. **Appelle `billingPortal.sessions.create`** avec `customer: user.stripeCustomerId` et `return_url` construit depuis `process.env.APP_URL`. Retourne `session.url`.
4. **Écris le controller** : `@Post('portal')`, `@UseGuards(JwtAuthGuard)`, `@CurrentUser()`, retourne `{ url }`. La route est protégée — on ouvre le portail *du client connecté*.
5. **Teste** : `curl -X POST http://localhost:3000/billing/portal` avec un JWT valide → récupère l'URL, ouvre-la, effectue une action (change de plan ou annule).
6. **Observe le webhook** : lance `stripe listen --forward-to localhost:3000/webhooks/stripe` (lab 03) et vérifie qu'après une action dans le portail, `customer.subscription.updated` (ou `.deleted`) arrive bien. C'est lui qui met à jour le `tier`, pas le retour navigateur.
7. **Cas limite** : appelle l'endpoint avec un utilisateur Free (sans `stripeCustomerId`) → tu dois obtenir un 400 métier clair, pas une erreur Stripe opaque.

---

## Corrigé complet commenté

```ts
// src/billing/billing.service.ts — corrigé
import {
  Injectable, Inject, BadRequestException, Logger,
} from '@nestjs/common';
import Stripe from 'stripe';
import type { User } from '../users/user.entity';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  // STRIPE_CLIENT = provider Stripe injecté (créé avec STRIPE_SECRET_KEY, mode test)
  constructor(@Inject('STRIPE_CLIENT') private readonly stripe: Stripe) {}

  async createPortalSession(user: User): Promise<string> {
    // 1. Garde-fou : sans Customer Stripe, aucun portail n'est possible.
    //    stripeCustomerId a été rattaché au module 03 (checkout.session.completed).
    //    Un utilisateur Free n'en a pas → erreur MÉTIER claire, pas une erreur Stripe.
    if (!user.stripeCustomerId) {
      throw new BadRequestException(
        "Aucun abonnement Stripe rattaché à ce compte",
      );
    }

    // 2. Création de la session de portail.
    //    customer  → REQUIS, le cus_... du client.
    //    return_url → où Stripe renvoie le client quand il ferme le portail (UX pure).
    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.APP_URL}/parametres/abonnement`,
    });

    this.logger.log(`Portail ouvert pour user ${user.id}`);

    // 3. session.url = URL hébergée Stripe, à USAGE UNIQUE et expirable.
    //    On la renvoie et on ne la stocke jamais : on la recrée à chaque clic.
    return session.url;
  }
}
```

```ts
// src/billing/billing.controller.ts — corrigé
import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../users/user.entity';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // Route PROTÉGÉE : contrairement au webhook (module 03, pas de JWT car
  // l'appelant est Stripe), ici l'appelant est un utilisateur connecté.
  // On ouvre SON portail, avec SON stripeCustomerId — jamais un id fourni par le client.
  @Post('portal')
  @UseGuards(JwtAuthGuard)
  async openPortal(@CurrentUser() user: User): Promise<{ url: string }> {
    const url = await this.billing.createPortalSession(user);
    // Le front fait window.location.href = url pour rediriger vers Stripe.
    return { url };
  }
}
```

```ts
// Front — bouton "Gérer mon abonnement" (rappel, pas à écrire côté back)
async function openBillingPortal() {
  const res = await fetch('/api/billing/portal', {
    method: 'POST',
    credentials: 'include',
  });
  const { url } = await res.json();
  window.location.href = url; // → page hébergée Stripe
}
```

**Pourquoi ce corrigé est correct :**
- **Garde-fou en tête** : un utilisateur sans `stripeCustomerId` obtient un 400 métier lisible, pas un « No such customer » Stripe.
- **`customer` + `return_url`** sont les deux paramètres nécessaires ; `customer` est requis, `return_url` ramène le client dans l'app (UX uniquement).
- **`session.url` n'est jamais stockée** : à usage unique, recréée à chaque clic.
- **Route protégée JWT** : on ouvre le portail du client connecté avec son propre `cus_...` — pas d'id passé par le client (sinon un utilisateur pourrait ouvrir le portail d'un autre).
- **La mise à jour du `tier`** se fait via le webhook `customer.subscription.*` (lab 03), pas au retour sur le `return_url`.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées :**

Reproduis l'endpoint `POST /billing/portal` **de mémoire, en 20 minutes**, avec ces modifications :

1. Passe le **paramètre optionnel `configuration`** à `billingPortal.sessions.create` (crée d'abord une configuration par API avec `billingPortal.configurations.create`, récupère son `id`, et applique-le à la session).
2. **Sans rouvrir ce corrigé** ni le module 05.

**Critère de réussite :** l'appel renvoie une URL de portail valide qui applique la configuration créée par API (et non celle par défaut du Dashboard), et une action dans le portail déclenche bien un `customer.subscription.updated` observé via `stripe listen`.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, l'endpoint vit ici :

```txt
tribuzen-api/
  src/
    billing/
      billing.controller.ts   ← POST /billing/portal (JWT)
      billing.service.ts       ← createPortalSession (billingPortal.sessions.create)
tribuzen-web/
  src/
    pages/parametres/abonnement  ← bouton "Gérer mon abonnement"
```

**Différences par rapport au lab :**

- Le `return_url` viendra d'une config d'environnement typée (`ConfigService`), pas d'un `process.env` brut.
- La configuration du portail (features, annulation `at_period_end`) sera versionnée par API (`billingPortal.configurations`) plutôt que cliquée dans le Dashboard, pour être reproductible entre les environnements test et live.
- La page `Paramètres → Abonnement` affichera aussi un état de synthèse (plan courant, prochaine échéance) lu depuis le `tier` mis à jour par les webhooks — mais l'unique action reste le bouton vers le portail.

**Commit cible :**
```
feat(billing): endpoint POST /billing/portal — ouvre le Customer Portal Stripe pour la famille
```
