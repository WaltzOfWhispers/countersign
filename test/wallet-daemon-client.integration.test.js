import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentWalletApp } from '../src/app.js';
import { generateEd25519Keypair, signPayload } from '../src/lib/crypto.js';
import { createWalletDaemonClient } from '../src/lib/wallet-daemon-client.js';

async function createHarness({ fundAmountCents = 20_000 } = {}) {
  const travelAgentKeys = generateEd25519Keypair();
  const rootDir = await mkdtemp(join(tmpdir(), 'wallet-daemon-client-test-'));
  const app = createAgentWalletApp({
    dataFile: join(rootDir, 'data', 'store.json'),
    trustedAgents: {
      'travel-agent': {
        id: 'travel-agent',
        publicKeyPem: travelAgentKeys.publicKeyPem
      }
    }
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

  const created = await send('/api/users', {
    method: 'POST',
    body: { name: 'Wallet Daemon Client Tester' }
  });
  const userId = created.data.user.id;

  if (fundAmountCents > 0) {
    await send(`/api/users/${userId}/fund`, {
      method: 'POST',
      body: { amountCents: fundAmountCents }
    });
  }

  const claimTokenResponse = await send(`/api/users/${userId}/claim-token`, {
    method: 'POST'
  });

  return {
    send,
    userId,
    claimToken: claimTokenResponse.data.activeClaimToken.token,
    travelAgentKeys
  };
}

async function pairTravelAgent(harness) {
  const securityCode = await harness.send(`/api/users/${harness.userId}/agent-link-code`, {
    method: 'POST'
  });
  assert.equal(securityCode.status, 201);

  const pairingPayload = {
    type: 'agent.wallet_pairing.v1',
    requestId: `pair_req_${Date.now()}`,
    agentId: 'travel-agent',
    walletAccountId: harness.userId,
    securityCode: securityCode.data.activeAgentLinkCode.code,
    timestamp: new Date().toISOString(),
    nonce: `pair_nonce_${Date.now()}`
  };

  const paired = await harness.send('/api/relay/agent-links', {
    method: 'POST',
    body: {
      payload: pairingPayload,
      signature: signPayload(pairingPayload, harness.travelAgentKeys.privateKeyPem)
    }
  });
  assert.equal(paired.status, 201);
}

test('wallet daemon client can claim, poll relay requests, and authorize travel-agent charges', async () => {
  const harness = await createHarness();
  const installationKeys = generateEd25519Keypair();
  const installation = {
    walletInstallationId: 'wallet_daemon_client_1',
    label: 'CLI daemon',
    publicKeyPem: installationKeys.publicKeyPem,
    privateKeyPem: installationKeys.privateKeyPem
  };
  const client = createWalletDaemonClient({ send: harness.send });

  const claim = await client.claimInstallation({
    installation,
    walletAccountId: harness.userId,
    claimToken: harness.claimToken
  });

  assert.equal(claim.walletInstallation.ownerUserId, harness.userId);
  await pairTravelAgent(harness);

  const relayPayload = {
    type: 'travel.payment_authorization_request.v1',
    requestId: 'travel_req_client_1',
    agentId: 'travel-agent',
    walletAccountId: harness.userId,
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_client_1',
    memo: 'Flight booking charge',
    timestamp: new Date().toISOString(),
    nonce: 'travel_client_nonce_1'
  };

  await harness.send('/api/relay/travel-agent/requests', {
    method: 'POST',
    body: {
      payload: relayPayload,
      signature: signPayload(relayPayload, harness.travelAgentKeys.privateKeyPem)
    }
  });

  const poll = await client.pollRequests({ installation });
  assert.equal(poll.requests.length, 1);
  assert.equal(poll.requests[0].payload.requestId, relayPayload.requestId);

  const authorization = await client.authorizeRequest({
    installation,
    relayRequest: poll.requests[0],
    walletAccountId: harness.userId
  });

  assert.equal(authorization.receipt.payload.type, 'wallet.travel_authorization.v1');
  assert.equal(authorization.receipt.payload.status, 'approved');
});

test('wallet daemon client can run a wallet-side Stripe charge with a linked payment method and no funded balance', async () => {
  const harness = await createHarness({ fundAmountCents: 0 });
  const installationKeys = generateEd25519Keypair();
  const installation = {
    walletInstallationId: 'wallet_daemon_client_2',
    label: 'CLI daemon',
    publicKeyPem: installationKeys.publicKeyPem,
    privateKeyPem: installationKeys.privateKeyPem,
    paymentMethod: {
      provider: 'mock_stripe_payment_method',
      customerId: 'cus_local_wallet_1',
      paymentMethodId: 'pm_local_wallet_1',
      cardBrand: 'visa',
      cardLast4: '4242',
      expMonth: 12,
      expYear: 2030
    }
  };
  const client = createWalletDaemonClient({ send: harness.send });

  await client.claimInstallation({
    installation,
    walletAccountId: harness.userId,
    claimToken: harness.claimToken
  });
  await pairTravelAgent(harness);

  const relayPayload = {
    type: 'travel.payment_authorization_request.v1',
    requestId: 'travel_req_client_wallet_charge_1',
    agentId: 'travel-agent',
    walletAccountId: harness.userId,
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_client_wallet_charge_1',
    memo: 'Flight booking charge',
    timestamp: new Date().toISOString(),
    nonce: 'travel_client_wallet_charge_nonce_1'
  };

  await harness.send('/api/relay/travel-agent/requests', {
    method: 'POST',
    body: {
      payload: relayPayload,
      signature: signPayload(relayPayload, harness.travelAgentKeys.privateKeyPem)
    }
  });

  const poll = await client.pollRequests({ installation });
  const result = await client.authorizeRequest({
    installation,
    relayRequest: poll.requests[0],
    walletAccountId: harness.userId
  });

  assert.equal(result.status, 'charged');
  assert.equal(result.execution.provider, 'mock_stripe_wallet_charge');
  assert.equal(result.execution.paymentMethodId, installation.paymentMethod.paymentMethodId);
  assert.equal(result.summary.wallet.balanceCents, 0);
});
