import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentWalletApp } from '../src/app.js';
import { generateEd25519Keypair, signPayload } from '../src/lib/crypto.js';

function createFakeStripeGateway() {
  const calls = [];

  return {
    enabled: true,
    publishableKey: 'pk_test_countersign',
    calls,
    async ensureCustomer({ existingCustomerId, walletAccountId }) {
      calls.push({ type: 'ensureCustomer', existingCustomerId, walletAccountId });
      return existingCustomerId || `cus_${walletAccountId}`;
    },
    async createSetupIntent({ customerId, walletAccountId, walletInstallationId }) {
      calls.push({
        type: 'createSetupIntent',
        customerId,
        walletAccountId,
        walletInstallationId
      });
      return {
        id: `seti_${walletInstallationId}`,
        clientSecret: `seti_secret_${walletInstallationId}`,
        customerId
      };
    },
    async getPaymentMethodForSetupIntent({ setupIntentId }) {
      calls.push({ type: 'getPaymentMethodForSetupIntent', setupIntentId });
      return {
        provider: 'stripe_payment_method',
        customerId: 'cus_wallet_stripe_1',
        paymentMethodId: 'pm_wallet_stripe_1',
        setupIntentId,
        cardBrand: 'visa',
        cardLast4: '4242',
        expMonth: 12,
        expYear: 2030
      };
    },
    async createFundingCharge({ customerId, paymentMethodId, amountCents, walletAccountId }) {
      calls.push({
        type: 'createFundingCharge',
        customerId,
        paymentMethodId,
        amountCents,
        walletAccountId
      });
      return {
        id: 'fund_stripe_1',
        provider: 'stripe',
        providerReference: 'pi_fund_wallet_1',
        status: 'succeeded',
        amountCents,
        customerId,
        paymentMethodId,
        createdAt: '2026-04-03T23:59:00.000Z'
      };
    },
    async createWalletCharge({
      customerId,
      paymentMethodId,
      amountCents,
      currency,
      walletAccountId,
      agentId,
      relayRequestId
    }) {
      calls.push({
        type: 'createWalletCharge',
        customerId,
        paymentMethodId,
        amountCents,
        currency,
        walletAccountId,
        agentId,
        relayRequestId
      });
      return {
        id: 'charge_stripe_1',
        provider: 'stripe_wallet_charge',
        providerReference: 'pi_wallet_charge_1',
        status: 'succeeded',
        amountCents,
        currency,
        walletAccountId,
        agentId,
        relayRequestId,
        paymentMethodId,
        customerId,
        cardBrand: 'visa',
        cardLast4: '4242',
        createdAt: '2026-04-03T23:59:05.000Z'
      };
    }
  };
}

async function createHarness() {
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-stripe-funding-test-'));
  const travelAgentKeys = generateEd25519Keypair();
  const stripeGateway = createFakeStripeGateway();
  const app = createAgentWalletApp({
    dataFile: join(rootDir, 'data', 'store.json'),
    walletDir: join(rootDir, 'local-wallet'),
    stripeGateway,
    trustedAgents: {
      'travel-agent': {
        id: 'travel-agent',
        publicKeyPem: travelAgentKeys.publicKeyPem
      }
    }
  });
  await app.ensureWalletIdentity();

  async function request(pathname, { method = 'GET', body } = {}) {
    const response = await app.routeRequest({
      method,
      pathname,
      body
    });

    return {
      status: response.statusCode,
      data: response.payload
    };
  }

  const created = await request('/api/users', {
    method: 'POST',
    body: { name: 'Stripe Wallet Tester' }
  });
  assert.equal(created.status, 201);

  const runtime = await request(`/api/users/${created.data.user.id}/local-runtime`, {
    method: 'POST',
    body: { label: 'Countersign Desktop' }
  });
  assert.equal(runtime.status, 201);

  return {
    app,
    request,
    stripeGateway,
    travelAgentKeys,
    walletAccountId: created.data.user.id,
    walletInstallationId:
      runtime.data.walletInstallation.walletInstallationId || runtime.data.walletInstallation.id
  };
}

test('funding API can create a Stripe setup intent and sync the linked payment method to the local runtime', async () => {
  const harness = await createHarness();

  const setupIntent = await harness.request(
    `/api/users/${harness.walletAccountId}/local-wallet-installations/${harness.walletInstallationId}/stripe/setup-intent`,
    {
      method: 'POST'
    }
  );

  assert.equal(setupIntent.status, 201);
  assert.equal(setupIntent.data.provider, 'stripe');
  assert.equal(setupIntent.data.publishableKey, 'pk_test_countersign');
  assert.equal(setupIntent.data.setupIntentId, `seti_${harness.walletInstallationId}`);
  assert.equal(setupIntent.data.clientSecret, `seti_secret_${harness.walletInstallationId}`);

  const linked = await harness.request(
    `/api/users/${harness.walletAccountId}/local-wallet-installations/${harness.walletInstallationId}/payment-method/stripe`,
    {
      method: 'POST',
      body: {
        setupIntentId: setupIntent.data.setupIntentId
      }
    }
  );

  assert.equal(linked.status, 200);
  assert.equal(
    linked.data.walletInstallation.paymentMethod.provider,
    'stripe_payment_method'
  );
  assert.equal(
    linked.data.walletInstallation.paymentMethod.paymentMethodId,
    'pm_wallet_stripe_1'
  );
  assert.equal(
    linked.data.dashboard.localWalletInstallations[0].paymentMethod.paymentMethodId,
    'pm_wallet_stripe_1'
  );
});

test('funding API uses the linked Stripe payment method for wallet top-ups', async () => {
  const harness = await createHarness();

  const setupIntent = await harness.request(
    `/api/users/${harness.walletAccountId}/local-wallet-installations/${harness.walletInstallationId}/stripe/setup-intent`,
    {
      method: 'POST'
    }
  );
  assert.equal(setupIntent.status, 201);

  const linked = await harness.request(
    `/api/users/${harness.walletAccountId}/local-wallet-installations/${harness.walletInstallationId}/payment-method/stripe`,
    {
      method: 'POST',
      body: {
        setupIntentId: setupIntent.data.setupIntentId
      }
    }
  );
  assert.equal(linked.status, 200);

  const funded = await harness.request(`/api/users/${harness.walletAccountId}/fund`, {
    method: 'POST',
    body: {
      amountCents: 12_500
    }
  });

  assert.equal(funded.status, 200);
  assert.equal(funded.data.wallet.balanceCents, 12_500);
  assert.equal(funded.data.wallet.fundingEvents[0].provider, 'stripe');
  assert.equal(funded.data.wallet.fundingEvents[0].paymentMethodId, 'pm_wallet_stripe_1');
  assert.equal(
    harness.stripeGateway.calls.some((call) => call.type === 'createFundingCharge'),
    true
  );
});

test('wallet review flow produces a Stripe-backed wallet charge when a linked Stripe payment method exists', async () => {
  const harness = await createHarness();

  const setupIntent = await harness.request(
    `/api/users/${harness.walletAccountId}/local-wallet-installations/${harness.walletInstallationId}/stripe/setup-intent`,
    {
      method: 'POST'
    }
  );
  assert.equal(setupIntent.status, 201);

  const linked = await harness.request(
    `/api/users/${harness.walletAccountId}/local-wallet-installations/${harness.walletInstallationId}/payment-method/stripe`,
    {
      method: 'POST',
      body: {
        setupIntentId: setupIntent.data.setupIntentId
      }
    }
  );
  assert.equal(linked.status, 200);

  const relayPayload = {
    type: 'travel.payment_authorization_request.v1',
    requestId: 'travel_req_stripe_wallet_charge_1',
    agentId: 'travel-agent',
    walletAccountId: harness.walletAccountId,
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_stripe_wallet_charge_1',
    memo: 'Flight booking charge',
    timestamp: new Date().toISOString(),
    nonce: 'travel_stripe_wallet_charge_nonce_1'
  };

  const enqueued = await harness.request('/api/relay/travel-agent/requests', {
    method: 'POST',
    body: {
      payload: relayPayload,
      signature: signPayload(relayPayload, harness.travelAgentKeys.privateKeyPem)
    }
  });
  assert.equal(enqueued.status, 202);

  const reviewed = await harness.request(
    `/api/users/${harness.walletAccountId}/local-wallet-installations/${harness.walletInstallationId}/requests/${relayPayload.requestId}/review`,
    {
      method: 'POST',
      body: {
        decision: 'approve'
      }
    }
  );

  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.data.result.status, 'charged');
  assert.equal(reviewed.data.result.execution.provider, 'stripe_wallet_charge');
  assert.equal(reviewed.data.result.execution.paymentMethodId, 'pm_wallet_stripe_1');
  assert.equal(
    harness.stripeGateway.calls.some((call) => call.type === 'createWalletCharge'),
    true
  );
});
