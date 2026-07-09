import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Stripe Billing',
  description:
    'Billing SaaS avec Stripe & NestJS : products/prices, Checkout, webhooks & idempotence, abonnements, Customer Portal, freemium/gating, dunning, facturation & légal, mise en production (débutant → expert)',
  lang: 'fr-FR',
  srcDir: '.',
  ignoreDeadLinks: true,

  // NB : PAS d'override `vue.template.compilerOptions.delimiters` (il casse le `{{ }}` du
  // thème par défaut). Les accolades du contenu restent dans des blocs de code.
  // cf docs/curriculum/DETTE-vitepress-delimiters.md

  themeConfig: {
    nav: [
      { text: 'Modules', link: '/modules/00-introduction-au-billing-saas' },
      { text: 'Labs', link: '/labs/lab-00-introduction-au-billing-saas/README' },
    ],

    sidebar: {
      '/modules/': [
        {
          text: 'Fondations',
          collapsed: false,
          items: [
            { text: '00 · Introduction au billing SaaS', link: '/modules/00-introduction-au-billing-saas' },
            { text: '01 · Stripe Products & Prices', link: '/modules/01-stripe-products-et-prices' },
            { text: '02 · Checkout & Payment Links', link: '/modules/02-stripe-checkout-et-payment-links' },
            { text: '03 · Webhooks & idempotence', link: '/modules/03-webhooks-et-idempotence' },
          ],
        },
        {
          text: 'Abonnements & self-service',
          collapsed: false,
          items: [
            { text: '04 · Subscriptions & cycle de vie', link: '/modules/04-subscriptions-et-cycle-de-vie' },
            { text: '05 · Customer Portal & self-service', link: '/modules/05-customer-portal-et-self-service' },
            { text: '06 · Freemium & feature gating', link: '/modules/06-freemium-et-feature-gating' },
          ],
        },
        {
          text: 'Robustesse & production',
          collapsed: false,
          items: [
            { text: '07 · Paiements échoués & dunning', link: '/modules/07-paiements-echoues-et-dunning' },
            { text: '08 · Facturation, taxes & légalité', link: '/modules/08-facturation-taxes-et-legalite' },
            { text: '09 · Testing & mise en production', link: '/modules/09-testing-et-mise-en-production' },
          ],
        },
      ],

      '/labs/': [
        {
          text: 'Labs — pratique (Stripe mode test + CLI)',
          collapsed: false,
          items: [
            { text: 'Lab 00 · Introduction au billing SaaS', link: '/labs/lab-00-introduction-au-billing-saas/README' },
            { text: 'Lab 01 · Products & Prices', link: '/labs/lab-01-stripe-products-et-prices/README' },
            { text: 'Lab 02 · Checkout & Payment Links', link: '/labs/lab-02-stripe-checkout-et-payment-links/README' },
            { text: 'Lab 03 · Webhooks & idempotence', link: '/labs/lab-03-webhooks-et-idempotence/README' },
            { text: 'Lab 04 · Subscriptions & cycle de vie', link: '/labs/lab-04-subscriptions-et-cycle-de-vie/README' },
            { text: 'Lab 05 · Customer Portal', link: '/labs/lab-05-customer-portal-et-self-service/README' },
            { text: 'Lab 06 · Freemium & feature gating', link: '/labs/lab-06-freemium-et-feature-gating/README' },
            { text: 'Lab 07 · Paiements échoués & dunning', link: '/labs/lab-07-paiements-echoues-et-dunning/README' },
            { text: 'Lab 08 · Facturation, taxes & légalité', link: '/labs/lab-08-facturation-taxes-et-legalite/README' },
            { text: 'Lab 09 · Testing & mise en production', link: '/labs/lab-09-testing-et-mise-en-production/README' },
          ],
        },
      ],
    },

    search: { provider: 'local' },
    outline: { level: [2, 3], label: 'Sur cette page' },
    docFooter: { prev: 'Page précédente', next: 'Page suivante' },
  },
})
