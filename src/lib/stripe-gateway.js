import Stripe from 'stripe';

import { createId, nowIsoTimestamp } from './ids.js';

function normalizeCardPaymentMethod(setupIntent, paymentMethod) {
  if (!paymentMethod || paymentMethod.type !== 'card' || !paymentMethod.card) {
    throw new Error('Stripe setup did not return a card payment method.');
  }

  return {
    provider: 'stripe_payment_method',
    customerId: typeof setupIntent.customer === 'string' ? setupIntent.customer : setupIntent.customer?.id,
    paymentMethodId: paymentMethod.id,
    setupIntentId: setupIntent.id,
    cardBrand: paymentMethod.card.brand,
    cardLast4: paymentMethod.card.last4,
    expMonth: paymentMethod.card.exp_month,
    expYear: paymentMethod.card.exp_year,
    createdAt: nowIsoTimestamp()
  };
}

export function createStripeGateway({
  secretKey = process.env.STRIPE_SECRET_KEY,
  publishableKey = process.env.STRIPE_PUBLISHABLE_KEY,
  stripeClient
} = {}) {
  const client = stripeClient || (secretKey ? new Stripe(secretKey) : null);

  return {
    enabled: Boolean(client && publishableKey),
    publishableKey,
    async ensureCustomer({ existingCustomerId, walletAccountId, walletName }) {
      if (!client) {
        throw new Error('Stripe is not configured.');
      }

      if (existingCustomerId) {
        return existingCustomerId;
      }

      const customer = await client.customers.create({
        name: walletName,
        metadata: {
          walletAccountId
        }
      });

      return customer.id;
    },
    async createSetupIntent({ customerId, walletAccountId, walletInstallationId }) {
      if (!client) {
        throw new Error('Stripe is not configured.');
      }

      const setupIntent = await client.setupIntents.create({
        customer: customerId,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never'
        },
        metadata: {
          walletAccountId,
          walletInstallationId
        },
        usage: 'off_session'
      });

      return {
        id: setupIntent.id,
        clientSecret: setupIntent.client_secret,
        customerId
      };
    },
    async getPaymentMethodForSetupIntent({ setupIntentId }) {
      if (!client) {
        throw new Error('Stripe is not configured.');
      }

      const setupIntent = await client.setupIntents.retrieve(setupIntentId, {
        expand: ['payment_method']
      });

      if (setupIntent.status !== 'succeeded') {
        throw new Error('Stripe setup intent is not complete yet.');
      }

      const paymentMethod =
        typeof setupIntent.payment_method === 'string' ? null : setupIntent.payment_method;

      return normalizeCardPaymentMethod(setupIntent, paymentMethod);
    },
    async createFundingCharge({ customerId, paymentMethodId, amountCents, walletAccountId }) {
      if (!client) {
        throw new Error('Stripe is not configured.');
      }

      const paymentIntent = await client.paymentIntents.create({
        amount: amountCents,
        currency: 'usd',
        customer: customerId,
        payment_method: paymentMethodId,
        confirm: true,
        off_session: true,
        metadata: {
          walletAccountId,
          purpose: 'wallet_top_up'
        }
      });

      return {
        id: createId('fund'),
        provider: 'stripe',
        providerReference: paymentIntent.id,
        status: paymentIntent.status,
        amountCents,
        customerId,
        paymentMethodId,
        createdAt: nowIsoTimestamp()
      };
    },
    async createWalletCharge({
      customerId,
      paymentMethodId,
      amountCents,
      currency = 'USD',
      walletAccountId,
      agentId,
      relayRequestId
    }) {
      if (!client) {
        throw new Error('Stripe is not configured.');
      }

      const paymentIntent = await client.paymentIntents.create({
        amount: amountCents,
        currency: String(currency || 'USD').toLowerCase(),
        customer: customerId,
        payment_method: paymentMethodId,
        confirm: true,
        off_session: true,
        metadata: {
          walletAccountId,
          agentId,
          relayRequestId,
          purpose: 'wallet_charge'
        }
      });

      return {
        id: createId('charge'),
        provider: 'stripe_wallet_charge',
        providerReference: paymentIntent.id,
        status: paymentIntent.status,
        amountCents,
        currency: String(currency || 'USD').toUpperCase(),
        walletAccountId,
        agentId,
        relayRequestId,
        paymentMethodId,
        customerId,
        createdAt: nowIsoTimestamp()
      };
    }
  };
}
