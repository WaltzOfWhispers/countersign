import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentWalletApp } from '../src/app.js';
import { generateEd25519Keypair, signPayload } from '../src/lib/crypto.js';

async function createHarness() {
  const travelAgentKeys = generateEd25519Keypair();
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-agent-pairing-test-'));
  const app = createAgentWalletApp({
    dataFile: join(rootDir, 'data', 'store.json'),
    walletDir: join(rootDir, 'local-wallet'),
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
    body: { name: 'Pairing Wallet' }
  });
  assert.equal(created.status, 201);

  const runtime = await request(`/api/users/${created.data.user.id}/local-runtime`, {
    method: 'POST',
    body: {
      label: 'Countersign Desktop'
    }
  });
  assert.equal(runtime.status, 201);

  return {
    request,
    walletAccountId: created.data.user.id,
    travelAgentKeys
  };
}

test('wallet can issue a one-time agent pairing code that a trusted agent redeems', async () => {
  const harness = await createHarness();

  const generatedCode = await harness.request(
    `/api/users/${harness.walletAccountId}/agent-link-code`,
    {
      method: 'POST'
    }
  );

  assert.equal(generatedCode.status, 201);
  assert.match(generatedCode.data.activeAgentLinkCode.code, /^\d{6}$/);

  const pairingPayload = {
    type: 'agent.wallet_pairing.v1',
    requestId: 'pair_req_1',
    agentId: 'travel-agent',
    walletAccountId: harness.walletAccountId,
    securityCode: generatedCode.data.activeAgentLinkCode.code,
    timestamp: new Date().toISOString(),
    nonce: 'pair_nonce_1'
  };

  const paired = await harness.request('/api/relay/agent-links', {
    method: 'POST',
    body: {
      payload: pairingPayload,
      signature: signPayload(pairingPayload, harness.travelAgentKeys.privateKeyPem)
    }
  });

  assert.equal(paired.status, 201);
  assert.equal(paired.data.link.walletAccountId, harness.walletAccountId);
  assert.equal(paired.data.link.agentId, 'travel-agent');
  assert.equal(paired.data.summary.activeAgentLinkCode, null);
  assert.deepEqual(
    paired.data.summary.linkedAgents.map((agent) => agent.agentId),
    ['travel-agent']
  );
});

test('relay rejects travel-agent payment requests until the wallet pairs that agent', async () => {
  const harness = await createHarness();

  const relayPayload = {
    type: 'travel.payment_authorization_request.v1',
    requestId: 'travel_req_pairing_gate_1',
    agentId: 'travel-agent',
    walletAccountId: harness.walletAccountId,
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_pairing_gate_1',
    memo: 'Flight booking charge',
    timestamp: new Date().toISOString(),
    nonce: 'travel_pairing_gate_nonce_1'
  };

  const enqueued = await harness.request('/api/relay/travel-agent/requests', {
    method: 'POST',
    body: {
      payload: relayPayload,
      signature: signPayload(relayPayload, harness.travelAgentKeys.privateKeyPem)
    }
  });

  assert.equal(enqueued.status, 403);
  assert.match(enqueued.data.error, /pair/i);
});
