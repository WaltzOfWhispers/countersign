import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentWalletApp } from '../src/app.js';
import { generateEd25519Keypair, signPayload, verifyPayload } from '../src/lib/crypto.js';

async function startTestServer() {
  const rootDir = await mkdtemp(join(tmpdir(), 'agent-wallet-test-'));
  const app = createAgentWalletApp({
    dataFile: join(rootDir, 'data', 'store.json')
  });
  await app.ensureWalletIdentity();

  async function request(pathname, { method = 'GET', body } = {}) {
    const response = await app.routeRequest({
      method,
      pathname,
      body
    });

    return { status: response.statusCode, data: response.payload };
  }

  return {
    app,
    request,
    async close() {
      return undefined;
    }
  };
}

async function createWalletHarness() {
  const harness = await startTestServer();

  const createResponse = await harness.request('/api/users', {
    method: 'POST',
    body: { name: 'Integration Tester' }
  });

  assert.equal(createResponse.status, 201);

  return {
    ...harness,
    userId: createResponse.data.user.id
  };
}

async function fundWallet(harness, amountCents) {
  const response = await harness.request(`/api/users/${harness.userId}/fund`, {
    method: 'POST',
    body: { amountCents }
  });

  assert.equal(response.status, 200);
  return response.data;
}

async function issueClaimToken(harness) {
  const response = await harness.request(`/api/users/${harness.userId}/claim-token`, {
    method: 'POST'
  });

  assert.equal(response.status, 201);
  return response.data.activeClaimToken.token;
}

async function claimAgent(harness, { agentId = 'agt_local_1', agentLabel = 'Travel agent' } = {}) {
  const keys = generateEd25519Keypair();
  const claimToken = await issueClaimToken(harness);
  const payload = {
    type: 'agent.claim.v1',
    requestId: 'req_claim_1',
    agentId,
    walletAccountId: harness.userId,
    claimToken,
    agentPubkey: keys.publicKeyPem,
    agentLabel,
    timestamp: new Date().toISOString(),
    nonce: 'nonce_claim_1'
  };
  const signature = signPayload(payload, keys.privateKeyPem);

  const response = await harness.request('/api/agent/claim', {
    method: 'POST',
    body: { payload, signature }
  });

  assert.equal(response.status, 200);

  const meta = await harness.request('/api/meta');
  assert.equal(meta.status, 200);
  assert.equal(
    verifyPayload(response.data.receipt.payload, response.data.receipt.signature, meta.data.wallet.publicKeyPem),
    true
  );

  return {
    keys,
    agentId,
    claimResponse: response.data
  };
}

test('wallet can be created and funded through the public API', async () => {
  const harness = await createWalletHarness();

  try {
    const funded = await fundWallet(harness, 25_000);

    assert.equal(funded.user.id, harness.userId);
    assert.equal(funded.wallet.balanceCents, 25_000);
    assert.equal(funded.wallet.fundingEvents.length, 1);
    assert.equal(funded.wallet.fundingEvents[0].provider, 'mock_stripe');
  } finally {
    await harness.close();
  }
});

test('agent claim returns a wallet-signed receipt and binds the installation to the wallet', async () => {
  const harness = await createWalletHarness();

  try {
    const { agentId, claimResponse } = await claimAgent(harness);

    assert.equal(claimResponse.receipt.payload.type, 'wallet.claim_receipt.v1');
    assert.equal(claimResponse.receipt.payload.agentId, agentId);
    assert.equal(claimResponse.receipt.payload.walletAccountId, harness.userId);
    assert.equal(claimResponse.agent.ownerUserId, harness.userId);
    assert.equal(claimResponse.summary.agents[0].id, agentId);
  } finally {
    await harness.close();
  }
});

test('wallet issues a signed challenge and approves a signed payment request under policy', async () => {
  const harness = await createWalletHarness();

  try {
    await fundWallet(harness, 20_000);
    const { keys, agentId } = await claimAgent(harness);

    const challenge = await harness.request('/api/agent/challenges', {
      method: 'POST',
      body: {
        agentId,
        walletAccountId: harness.userId,
        scope: 'payment.request'
      }
    });

    assert.equal(challenge.status, 201);

    const meta = await harness.request('/api/meta');
    assert.equal(
      verifyPayload(challenge.data.payload, challenge.data.signature, meta.data.wallet.publicKeyPem),
      true
    );

    const paymentPayload = {
      type: 'agent.payment_request.v1',
      requestId: 'pay_req_1',
      challengeId: challenge.data.payload.challengeId,
      walletNonce: challenge.data.payload.walletNonce,
      agentId,
      walletAccountId: harness.userId,
      merchantId: 'travel-api',
      merchantDomain: 'api.travel.example',
      amount: {
        currency: 'USD',
        minor: 2450
      },
      memo: 'Hotel hold',
      timestamp: new Date().toISOString(),
      idempotencyKey: 'idem_1'
    };
    const paymentSignature = signPayload(paymentPayload, keys.privateKeyPem);

    const payment = await harness.request('/api/agent/payments/request', {
      method: 'POST',
      body: { payload: paymentPayload, signature: paymentSignature }
    });

    assert.equal(payment.status, 200);
    assert.equal(
      verifyPayload(payment.data.payload, payment.data.signature, meta.data.wallet.publicKeyPem),
      true
    );
    assert.equal(payment.data.payload.type, 'wallet.payment_receipt.v1');
    assert.equal(payment.data.payload.status, 'approved');
    assert.equal(payment.data.payload.reasonCode, 'policy_passed');
    assert.equal(payment.data.payload.balanceRemaining.minor, 17_550);
  } finally {
    await harness.close();
  }
});

test('wallet returns pending approval for higher spend and signs the final approval receipt', async () => {
  const harness = await createWalletHarness();

  try {
    await fundWallet(harness, 20_000);
    const { keys, agentId } = await claimAgent(harness);

    const challenge = await harness.request('/api/agent/challenges', {
      method: 'POST',
      body: {
        agentId,
        walletAccountId: harness.userId,
        scope: 'payment.request'
      }
    });

    const paymentPayload = {
      type: 'agent.payment_request.v1',
      requestId: 'pay_req_2',
      challengeId: challenge.data.payload.challengeId,
      walletNonce: challenge.data.payload.walletNonce,
      agentId,
      walletAccountId: harness.userId,
      merchantId: 'travel-api',
      merchantDomain: 'api.travel.example',
      amount: {
        currency: 'USD',
        minor: 9000
      },
      memo: 'Flight hold',
      timestamp: new Date().toISOString(),
      idempotencyKey: 'idem_2'
    };
    const paymentSignature = signPayload(paymentPayload, keys.privateKeyPem);

    const payment = await harness.request('/api/agent/payments/request', {
      method: 'POST',
      body: { payload: paymentPayload, signature: paymentSignature }
    });

    assert.equal(payment.status, 200);
    assert.equal(payment.data.payload.status, 'pending_approval');
    assert.equal(payment.data.payload.reasonCode, 'human_approval_required');

    const meta = await harness.request('/api/meta');
    const approval = await harness.request(`/api/approvals/${paymentPayload.requestId}/approve`, {
      method: 'POST'
    });

    assert.equal(approval.status, 200);
    assert.equal(
      verifyPayload(approval.data.receipt.payload, approval.data.receipt.signature, meta.data.wallet.publicKeyPem),
      true
    );
    assert.equal(approval.data.receipt.payload.type, 'wallet.payment_finalized.v1');
    assert.equal(approval.data.receipt.payload.status, 'approved');
    assert.equal(approval.data.payment.reason, 'approved_by_user');
    assert.equal(approval.data.summary.wallet.balanceCents, 11_000);
  } finally {
    await harness.close();
  }
});
