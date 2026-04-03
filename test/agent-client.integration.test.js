import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentWalletApp } from '../src/app.js';
import { generateEd25519Keypair } from '../src/lib/crypto.js';
import { createAgentClient } from '../src/lib/agent-client.js';

async function createHarness() {
  const rootDir = await mkdtemp(join(tmpdir(), 'agent-wallet-client-test-'));
  const app = createAgentWalletApp({
    dataFile: join(rootDir, 'data', 'store.json')
  });

  await app.ensureWalletIdentity();

  const send = async (pathname, { method = 'GET', body } = {}) => {
    const response = await app.routeRequest({
      method,
      pathname,
      body
    });

    return {
      status: response.statusCode,
      data: response.payload
    };
  };

  const createWallet = await send('/api/users', {
    method: 'POST',
    body: { name: 'CLI Tester' }
  });
  const userId = createWallet.data.user.id;

  await send(`/api/users/${userId}/fund`, {
    method: 'POST',
    body: { amountCents: 20_000 }
  });

  const claimToken = await send(`/api/users/${userId}/claim-token`, {
    method: 'POST'
  });

  return {
    userId,
    claimToken: claimToken.data.activeClaimToken.token,
    send
  };
}

test('agent client can claim an installation and submit a signed payment request', async () => {
  const harness = await createHarness();
  const keys = generateEd25519Keypair();
  const client = createAgentClient({ send: harness.send });
  const installation = {
    agentId: 'agt_cli_1',
    label: 'Travel agent',
    publicKeyPem: keys.publicKeyPem,
    privateKeyPem: keys.privateKeyPem
  };

  const claim = await client.claimInstallation({
    installation,
    claimToken: harness.claimToken,
    walletAccountId: harness.userId
  });

  assert.equal(claim.receipt.payload.type, 'wallet.claim_receipt.v1');
  assert.equal(claim.agent.ownerUserId, harness.userId);

  const payment = await client.requestPayment({
    installation,
    walletAccountId: harness.userId,
    merchantId: 'travel-api',
    merchantDomain: 'api.travel.example',
    amountMinor: 2450,
    currency: 'USD',
    memo: 'Hotel hold'
  });

  assert.equal(payment.receipt.payload.type, 'wallet.payment_receipt.v1');
  assert.equal(payment.receipt.payload.status, 'approved');
  assert.equal(payment.receipt.payload.balanceRemaining.minor, 17_550);
});
