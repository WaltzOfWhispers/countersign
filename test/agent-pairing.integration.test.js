import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentWalletApp } from '../src/app.js';
import { generateEd25519Keypair, signPayload } from '../src/lib/crypto.js';

async function createHarness({ trusted = true } = {}) {
  const travelAgentKeys = generateEd25519Keypair();
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-trusted-agent-test-'));
  const app = createAgentWalletApp({
    dataFile: join(rootDir, 'data', 'store.json'),
    walletDir: join(rootDir, 'local-wallet'),
    trustedAgents: trusted
      ? {
          'travel-agent': {
            id: 'travel-agent',
            publicKeyPem: travelAgentKeys.publicKeyPem
          }
        }
      : {}
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
    body: { name: 'Trusted Agent Wallet' }
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
    walletInstallationId:
      runtime.data.walletInstallation.walletInstallationId || runtime.data.walletInstallation.id,
    travelAgentKeys
  };
}

test('trusted travel-agent requests are accepted without wallet-agent pairing', async () => {
  const harness = await createHarness();

  const relayPayload = {
    type: 'travel.payment_authorization_request.v1',
    requestId: 'travel_req_trusted_1',
    agentId: 'travel-agent',
    walletAccountId: harness.walletAccountId,
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_trusted_1',
    memo: 'Flight booking charge',
    timestamp: new Date().toISOString(),
    nonce: 'travel_trusted_nonce_1'
  };

  const enqueued = await harness.request('/api/relay/travel-agent/requests', {
    method: 'POST',
    body: {
      payload: relayPayload,
      signature: signPayload(relayPayload, harness.travelAgentKeys.privateKeyPem)
    }
  });

  assert.equal(enqueued.status, 202);
  assert.equal(enqueued.data.status, 'pending_wallet');
  assert.equal(enqueued.data.walletInstallationId, harness.walletInstallationId);
});

test('relay still rejects travel-agent payment requests from untrusted agents', async () => {
  const harness = await createHarness({ trusted: false });

  const relayPayload = {
    type: 'travel.payment_authorization_request.v1',
    requestId: 'travel_req_untrusted_1',
    agentId: 'travel-agent',
    walletAccountId: harness.walletAccountId,
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_untrusted_1',
    memo: 'Flight booking charge',
    timestamp: new Date().toISOString(),
    nonce: 'travel_untrusted_nonce_1'
  };

  const enqueued = await harness.request('/api/relay/travel-agent/requests', {
    method: 'POST',
    body: {
      payload: relayPayload,
      signature: signPayload(relayPayload, harness.travelAgentKeys.privateKeyPem)
    }
  });

  assert.equal(enqueued.status, 403);
  assert.match(enqueued.data.error, /trusted/i);
});
