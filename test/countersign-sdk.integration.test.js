import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { createAgentWalletApp } from '../src/app.js';
import { generateEd25519Keypair, signPayload } from '../src/lib/crypto.js';
import { createCountersignClient } from '../src/sdk/index.js';
import { requestJson } from '../src/lib/http-client.js';
import { createWalletDaemonClient } from '../src/lib/wallet-daemon-client.js';

async function createHarness({ fundAmountCents = 20_000 } = {}) {
  const travelAgentKeys = generateEd25519Keypair();
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-sdk-test-'));
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
    body: { name: 'Countersign SDK Tester' }
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

test('Countersign SDK can enqueue a signed travel-agent authorization request', async () => {
  const harness = await createHarness();
  const walletKeys = generateEd25519Keypair();

  const claimPayload = {
    type: 'wallet.claim.v1',
    requestId: 'wallet_claim_req_sdk_1',
    walletInstallationId: 'wallet_install_sdk_1',
    walletAccountId: harness.userId,
    claimToken: harness.claimToken,
    walletPubkey: walletKeys.publicKeyPem,
    walletLabel: 'SDK daemon',
    timestamp: new Date().toISOString(),
    nonce: 'wallet_claim_nonce_sdk_1'
  };

  await harness.send('/api/wallets/claim', {
    method: 'POST',
    body: {
      payload: claimPayload,
      signature: signPayload(claimPayload, walletKeys.privateKeyPem)
    }
  });

  const client = createCountersignClient({
    agentId: 'travel-agent',
    privateKeyPem: harness.travelAgentKeys.privateKeyPem,
    send: harness.send
  });

  const relayRequest = await client.enqueueAuthorizationRequest({
    walletAccountId: harness.userId,
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_sdk_1',
    memo: 'Flight booking charge'
  });

  assert.equal(relayRequest.status, 'pending_wallet');
  assert.equal(relayRequest.walletInstallationId, 'wallet_install_sdk_1');
});

test('Countersign SDK can fetch and verify a wallet authorization receipt', async () => {
  const harness = await createHarness();
  const walletKeys = generateEd25519Keypair();
  const walletInstallationId = 'wallet_install_sdk_2';

  const claimPayload = {
    type: 'wallet.claim.v1',
    requestId: 'wallet_claim_req_sdk_2',
    walletInstallationId,
    walletAccountId: harness.userId,
    claimToken: harness.claimToken,
    walletPubkey: walletKeys.publicKeyPem,
    walletLabel: 'SDK daemon',
    timestamp: new Date().toISOString(),
    nonce: 'wallet_claim_nonce_sdk_2'
  };

  await harness.send('/api/wallets/claim', {
    method: 'POST',
    body: {
      payload: claimPayload,
      signature: signPayload(claimPayload, walletKeys.privateKeyPem)
    }
  });

  const client = createCountersignClient({
    agentId: 'travel-agent',
    privateKeyPem: harness.travelAgentKeys.privateKeyPem,
    send: harness.send
  });

  const relayRequest = await client.enqueueAuthorizationRequest({
    walletAccountId: harness.userId,
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_sdk_2',
    memo: 'Flight booking charge',
    requestId: 'travel_req_sdk_2'
  });

  const authorizationPayload = {
    type: 'wallet.travel_authorization.v1',
    relayRequestId: relayRequest.relayRequestId,
    walletInstallationId,
    walletAccountId: harness.userId,
    agentId: 'travel-agent',
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_sdk_2',
    status: 'approved',
    reasonCode: 'policy_passed',
    authorizedAt: new Date().toISOString(),
    nonce: 'wallet_decision_nonce_sdk_2'
  };

  await harness.send('/api/relay/wallet-authorizations', {
    method: 'POST',
    body: {
      payload: authorizationPayload,
      signature: signPayload(authorizationPayload, walletKeys.privateKeyPem)
    }
  });

  const authorizationResult = await client.getAuthorizationResult({
    relayRequestId: relayRequest.relayRequestId
  });

  assert.equal(authorizationResult.status, 'authorized');
  assert.equal(authorizationResult.receipt.payload.status, 'approved');
  assert.equal(authorizationResult.verified, true);
});

test('Countersign SDK can capture an authorized travel-agent charge', async () => {
  const harness = await createHarness();
  const walletKeys = generateEd25519Keypair();
  const walletInstallationId = 'wallet_install_sdk_3';

  const claimPayload = {
    type: 'wallet.claim.v1',
    requestId: 'wallet_claim_req_sdk_3',
    walletInstallationId,
    walletAccountId: harness.userId,
    claimToken: harness.claimToken,
    walletPubkey: walletKeys.publicKeyPem,
    walletLabel: 'SDK daemon',
    timestamp: new Date().toISOString(),
    nonce: 'wallet_claim_nonce_sdk_3'
  };

  await harness.send('/api/wallets/claim', {
    method: 'POST',
    body: {
      payload: claimPayload,
      signature: signPayload(claimPayload, walletKeys.privateKeyPem)
    }
  });

  const client = createCountersignClient({
    agentId: 'travel-agent',
    privateKeyPem: harness.travelAgentKeys.privateKeyPem,
    send: harness.send
  });

  const relayRequest = await client.enqueueAuthorizationRequest({
    walletAccountId: harness.userId,
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_sdk_3',
    memo: 'Flight booking charge',
    requestId: 'travel_req_sdk_3'
  });

  const authorizationPayload = {
    type: 'wallet.travel_authorization.v1',
    relayRequestId: relayRequest.relayRequestId,
    walletInstallationId,
    walletAccountId: harness.userId,
    agentId: 'travel-agent',
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_sdk_3',
    status: 'approved',
    reasonCode: 'policy_passed',
    authorizedAt: new Date().toISOString(),
    nonce: 'wallet_decision_nonce_sdk_3'
  };

  await harness.send('/api/relay/wallet-authorizations', {
    method: 'POST',
    body: {
      payload: authorizationPayload,
      signature: signPayload(authorizationPayload, walletKeys.privateKeyPem)
    }
  });

  const capture = await client.captureAuthorizedCharge({
    relayRequestId: relayRequest.relayRequestId
  });

  assert.equal(capture.charge.provider, 'mock_stripe_travel_charge');
  assert.equal(capture.charge.status, 'captured');
  assert.equal(capture.summary.wallet.balanceCents, 17_550);
});

test('Countersign SDK can talk to a running server by baseUrl', async () => {
  const travelAgentKeys = generateEd25519Keypair();
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-sdk-http-test-'));
  const app = createAgentWalletApp({
    dataFile: join(rootDir, 'data', 'store.json'),
    trustedAgents: {
      'travel-agent': {
        id: 'travel-agent',
        publicKeyPem: travelAgentKeys.publicKeyPem
      }
    }
  });

  const server = await app.start({ port: 0, host: '127.0.0.1' });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const created = await requestJson(`${baseUrl}/api/users`, {
      method: 'POST',
      body: { name: 'Countersign SDK HTTP Tester' }
    });

    await requestJson(`${baseUrl}/api/users/${created.user.id}/fund`, {
      method: 'POST',
      body: { amountCents: 20_000 }
    });

    const claimTokenResponse = await requestJson(`${baseUrl}/api/users/${created.user.id}/claim-token`, {
      method: 'POST'
    });

    const walletKeys = generateEd25519Keypair();
    const claimPayload = {
      type: 'wallet.claim.v1',
      requestId: 'wallet_claim_req_sdk_http_1',
      walletInstallationId: 'wallet_install_sdk_http_1',
      walletAccountId: created.user.id,
      claimToken: claimTokenResponse.activeClaimToken.token,
      walletPubkey: walletKeys.publicKeyPem,
      walletLabel: 'SDK daemon',
      timestamp: new Date().toISOString(),
      nonce: 'wallet_claim_nonce_sdk_http_1'
    };

    await requestJson(`${baseUrl}/api/wallets/claim`, {
      method: 'POST',
      body: {
        payload: claimPayload,
        signature: signPayload(claimPayload, walletKeys.privateKeyPem)
      }
    });

    const client = createCountersignClient({
      baseUrl,
      agentId: 'travel-agent',
      privateKeyPem: travelAgentKeys.privateKeyPem
    });

    const runtime = await requestJson(`${baseUrl}/api/users/${created.user.id}/local-runtime`, {
      method: 'POST',
      body: {
        label: 'Countersign Desktop'
      }
    });
    assert.equal(runtime.walletInstallation.ownerUserId, created.user.id);

    const relayRequest = await client.enqueueAuthorizationRequest({
      walletAccountId: created.user.id,
      amount: {
        currency: 'USD',
        minor: 2450
      },
      bookingReference: 'trip_sdk_http_1',
      memo: 'Flight booking charge'
    });

    assert.equal(relayRequest.status, 'pending_wallet');
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('Countersign SDK sees a wallet-executed Stripe charge after local wallet approval', async () => {
  const harness = await createHarness({ fundAmountCents: 0 });
  const walletKeys = generateEd25519Keypair();
  const installation = {
    walletInstallationId: 'wallet_install_sdk_4',
    label: 'SDK daemon',
    publicKeyPem: walletKeys.publicKeyPem,
    privateKeyPem: walletKeys.privateKeyPem,
    paymentMethod: {
      provider: 'mock_stripe_payment_method',
      customerId: 'cus_sdk_wallet_1',
      paymentMethodId: 'pm_sdk_wallet_1',
      cardBrand: 'visa',
      cardLast4: '4242',
      expMonth: 12,
      expYear: 2030
    }
  };
  const walletClient = createWalletDaemonClient({ send: harness.send });

  await walletClient.claimInstallation({
    installation,
    walletAccountId: harness.userId,
    claimToken: harness.claimToken
  });

  const client = createCountersignClient({
    agentId: 'travel-agent',
    privateKeyPem: harness.travelAgentKeys.privateKeyPem,
    send: harness.send
  });

  const relayRequest = await client.enqueueAuthorizationRequest({
    walletAccountId: harness.userId,
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_sdk_4',
    memo: 'Flight booking charge',
    requestId: 'travel_req_sdk_4'
  });

  const pending = await walletClient.pollRequests({ installation });
  await walletClient.authorizeRequest({
    installation,
    relayRequest: pending.requests[0],
    walletAccountId: harness.userId
  });

  const paymentResult = await client.getAuthorizationResult({
    relayRequestId: relayRequest.relayRequestId
  });

  assert.equal(paymentResult.status, 'charged');
  assert.equal(paymentResult.execution.provider, 'mock_stripe_wallet_charge');
  assert.equal(paymentResult.execution.paymentMethodId, installation.paymentMethod.paymentMethodId);
});
