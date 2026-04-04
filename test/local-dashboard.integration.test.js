import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentWalletApp } from '../src/app.js';
import { generateEd25519Keypair, signPayload } from '../src/lib/crypto.js';

async function createHarness({ trustedAgents = {} } = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-local-dashboard-test-'));
  const app = createAgentWalletApp({
    dataFile: join(rootDir, 'data', 'store.json'),
    walletDir: join(rootDir, 'local-wallet'),
    trustedAgents
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
    body: { name: 'Dashboard Wallet' }
  });
  assert.equal(created.status, 201);

  return {
    app,
    request,
    walletAccountId: created.data.user.id
  };
}

async function generateClaimToken(harness) {
  const response = await harness.request(`/api/users/${harness.walletAccountId}/claim-token`, {
    method: 'POST'
  });

  assert.equal(response.status, 201);
  return response.data.activeClaimToken.token;
}

async function installLinkedClaimedWallet(harness) {
  const claimToken = await generateClaimToken(harness);

  const installed = await harness.request(
    `/api/users/${harness.walletAccountId}/local-wallet-installations`,
    {
      method: 'POST',
      body: { label: 'Browser wallet' }
    }
  );
  assert.equal(installed.status, 201);

  const walletInstallationId = installed.data.walletInstallation.walletInstallationId;

  const linked = await harness.request(
    `/api/users/${harness.walletAccountId}/local-wallet-installations/${walletInstallationId}/payment-method`,
    {
      method: 'POST',
      body: {
        cardBrand: 'visa',
        cardLast4: '4242',
        expMonth: 12,
        expYear: 2030
      }
    }
  );
  assert.equal(linked.status, 200);

  const claimed = await harness.request(
    `/api/users/${harness.walletAccountId}/local-wallet-installations/${walletInstallationId}/claim`,
    {
      method: 'POST',
      body: { claimToken }
    }
  );
  assert.equal(claimed.status, 200);

  return {
    walletInstallationId
  };
}

test('local dashboard API can install, link, claim, and list a wallet daemon', async () => {
  const harness = await createHarness();

  const updatedPolicy = await harness.request(`/api/users/${harness.walletAccountId}/policy`, {
    method: 'PUT',
    body: {
      perTransactionLimitCents: 12500,
      dailyCapCents: 40000,
      approvalThresholdCents: 5000,
      allowedMerchants: ['travel-agent']
    }
  });
  assert.equal(updatedPolicy.status, 200);

  const { walletInstallationId } = await installLinkedClaimedWallet(harness);
  const beforeSecondCard = await harness.request(`/api/users/${harness.walletAccountId}/local-dashboard`);
  const firstPaymentMethodId =
    beforeSecondCard.data.localWalletInstallations[0].paymentMethods[0].paymentMethodId;

  const dashboard = await harness.request(`/api/users/${harness.walletAccountId}/local-dashboard`);

  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.data.summary.user.id, harness.walletAccountId);
  assert.equal(dashboard.data.localWalletInstallations.length, 1);
  assert.equal(dashboard.data.localWalletInstallations[0].walletInstallationId, walletInstallationId);
  assert.equal(dashboard.data.localWalletInstallations[0].claimStatus, 'claimed');
  assert.equal(dashboard.data.localWalletInstallations[0].ownerUserId, harness.walletAccountId);
  assert.equal(dashboard.data.localWalletInstallations[0].paymentMethod.cardLast4, '4242');
  assert.deepEqual(dashboard.data.localWalletInstallations[0].pendingRequests, []);
  assert.deepEqual(dashboard.data.summary.wallet.policy, {
    perTransactionLimitCents: 12500,
    dailyCapCents: 40000,
    approvalThresholdCents: 5000,
    allowedMerchants: ['travel-agent']
  });
});

test('local app API can list wallets created outside the current browser session', async () => {
  const harness = await createHarness();

  const secondWallet = await harness.request('/api/users', {
    method: 'POST',
    body: { name: 'Claude-created wallet' }
  });
  assert.equal(secondWallet.status, 201);

  const listed = await harness.request('/api/users');

  assert.equal(listed.status, 200);
  assert.equal(listed.data.wallets.length, 2);
  assert.deepEqual(
    listed.data.wallets.map((wallet) => wallet.id).sort(),
    [harness.walletAccountId, secondWallet.data.user.id].sort()
  );
  assert.equal(
    listed.data.wallets.find((wallet) => wallet.id === secondWallet.data.user.id).name,
    'Claude-created wallet'
  );
});

test('local app API can auto-provision and claim a desktop runtime without a manual claim token', async () => {
  const harness = await createHarness();

  const result = await harness.request(`/api/users/${harness.walletAccountId}/local-runtime`, {
    method: 'POST',
    body: {
      label: 'Countersign Desktop'
    }
  });

  assert.equal(result.status, 201);
  assert.equal(result.data.walletInstallation.ownerUserId, harness.walletAccountId);
  assert.equal(result.data.walletInstallation.label, 'Countersign Desktop');
  assert.equal(result.data.dashboard.summary.walletInstallations.length, 1);
  assert.equal(result.data.dashboard.localWalletInstallations.length, 1);
  assert.equal(result.data.dashboard.localWalletInstallations[0].claimStatus, 'claimed');
});

test('local app API can auto-provision a desktop runtime from a legacy store missing wallet installation state', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-legacy-store-test-'));
  const dataFile = join(rootDir, 'data', 'store.json');
  await mkdir(join(rootDir, 'data'), { recursive: true });
  await writeFile(
    dataFile,
    JSON.stringify(
      {
        version: 1,
        walletIdentity: null,
        users: {},
        agents: {},
        claimTokens: {},
        relayRequests: {},
        challenges: {},
        paymentRequests: {}
      },
      null,
      2
    ),
    'utf8'
  );

  const app = createAgentWalletApp({
    dataFile,
    walletDir: join(rootDir, 'local-wallet')
  });
  await app.ensureWalletIdentity();

  const created = await app.routeRequest({
    method: 'POST',
    pathname: '/api/users',
    body: { name: 'Legacy wallet' }
  });
  assert.equal(created.statusCode, 201);

  const result = await app.routeRequest({
    method: 'POST',
    pathname: `/api/users/${created.payload.user.id}/local-runtime`,
    body: {
      label: 'Countersign Desktop'
    }
  });

  assert.equal(result.statusCode, 201);
  assert.equal(result.payload.walletInstallation.ownerUserId, created.payload.user.id);
  assert.equal(result.payload.dashboard.summary.walletInstallations.length, 1);
});

test('local dashboard API can approve a travel-agent request and show the wallet-run charge', async () => {
  const travelAgentKeys = generateEd25519Keypair();
  const harness = await createHarness({
    trustedAgents: {
      'travel-agent': {
        id: 'travel-agent',
        publicKeyPem: travelAgentKeys.publicKeyPem
      }
    }
  });

  const { walletInstallationId } = await installLinkedClaimedWallet(harness);
  const relayPayload = {
    type: 'travel.payment_authorization_request.v1',
    requestId: 'travel_req_dashboard_1',
    agentId: 'travel-agent',
    walletAccountId: harness.walletAccountId,
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_dashboard_1',
    memo: 'Flight booking charge',
    timestamp: new Date().toISOString(),
    nonce: 'travel_nonce_dashboard_1'
  };

  const enqueued = await harness.request('/api/relay/travel-agent/requests', {
    method: 'POST',
    body: {
      payload: relayPayload,
      signature: signPayload(relayPayload, travelAgentKeys.privateKeyPem)
    }
  });
  assert.equal(enqueued.status, 202);

  const beforeReview = await harness.request(`/api/users/${harness.walletAccountId}/local-dashboard`);
  assert.equal(beforeReview.data.localWalletInstallations[0].pendingRequests.length, 1);
  assert.equal(
    beforeReview.data.localWalletInstallations[0].pendingRequests[0].requestId,
    relayPayload.requestId
  );

  const review = await harness.request(
    `/api/users/${harness.walletAccountId}/local-wallet-installations/${walletInstallationId}/requests/${relayPayload.requestId}/review`,
    {
      method: 'POST',
      body: {
        decision: 'approve'
      }
    }
  );

  assert.equal(review.status, 200);
  assert.equal(review.data.result.status, 'charged');
  assert.equal(review.data.result.execution.provider, 'mock_stripe_wallet_charge');

  const afterReview = await harness.request(`/api/users/${harness.walletAccountId}/local-dashboard`);
  assert.deepEqual(afterReview.data.localWalletInstallations[0].pendingRequests, []);
  assert.equal(afterReview.data.summary.transactions[0].status, 'charged');
  assert.equal(afterReview.data.summary.transactions[0].execution.provider, 'mock_stripe_wallet_charge');

  const agentView = await harness.request(`/api/relay/travel-agent/requests/${relayPayload.requestId}`);
  assert.equal(agentView.status, 200);
  assert.equal(agentView.data.status, 'charged');
  assert.equal(agentView.data.execution.provider, 'mock_stripe_wallet_charge');
});

test('local dashboard API can approve a travel-agent request with a selected saved card', async () => {
  const travelAgentKeys = generateEd25519Keypair();
  const harness = await createHarness({
    trustedAgents: {
      'travel-agent': {
        id: 'travel-agent',
        publicKeyPem: travelAgentKeys.publicKeyPem
      }
    }
  });

  const { walletInstallationId } = await installLinkedClaimedWallet(harness);
  const beforeSecondCard = await harness.request(`/api/users/${harness.walletAccountId}/local-dashboard`);
  const firstPaymentMethodId =
    beforeSecondCard.data.localWalletInstallations[0].paymentMethods[0].paymentMethodId;

  const secondCard = await harness.request(
    `/api/users/${harness.walletAccountId}/local-wallet-installations/${walletInstallationId}/payment-method`,
    {
      method: 'POST',
      body: {
        cardBrand: 'mastercard',
        cardLast4: '5454',
        expMonth: 8,
        expYear: 2031
      }
    }
  );
  assert.equal(secondCard.status, 200);

  const relayPayload = {
    type: 'travel.payment_authorization_request.v1',
    requestId: 'travel_req_dashboard_card_choice_1',
    agentId: 'travel-agent',
    walletAccountId: harness.walletAccountId,
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_dashboard_card_choice_1',
    memo: 'Flight booking charge',
    timestamp: new Date().toISOString(),
    nonce: 'travel_nonce_dashboard_card_choice_1'
  };

  const enqueued = await harness.request('/api/relay/travel-agent/requests', {
    method: 'POST',
    body: {
      payload: relayPayload,
      signature: signPayload(relayPayload, travelAgentKeys.privateKeyPem)
    }
  });
  assert.equal(enqueued.status, 202);

  const review = await harness.request(
    `/api/users/${harness.walletAccountId}/local-wallet-installations/${walletInstallationId}/requests/${relayPayload.requestId}/review`,
    {
      method: 'POST',
      body: {
        decision: 'approve',
        paymentMethodId: firstPaymentMethodId
      }
    }
  );

  assert.equal(review.status, 200);
  assert.equal(review.data.result.status, 'charged');
  assert.equal(review.data.result.execution.provider, 'mock_stripe_wallet_charge');
  assert.equal(review.data.result.execution.paymentMethodId, firstPaymentMethodId);
  assert.equal(review.data.result.execution.cardLast4, '4242');

  const agentView = await harness.request(`/api/relay/travel-agent/requests/${relayPayload.requestId}`);
  assert.equal(agentView.status, 200);
  assert.equal(agentView.data.status, 'charged');
  assert.equal(agentView.data.execution.paymentMethodId, firstPaymentMethodId);
  assert.equal(agentView.data.execution.cardLast4, '4242');
});
