import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentWalletApp } from '../src/app.js';
import { generateEd25519Keypair, signPayload, verifyPayload } from '../src/lib/crypto.js';

async function createHarness() {
  const travelAgentKeys = generateEd25519Keypair();
  const rootDir = await mkdtemp(join(tmpdir(), 'agent-wallet-daemon-test-'));
  const app = createAgentWalletApp({
    dataFile: join(rootDir, 'data', 'store.json'),
    trustedAgents: {
      'travel-agent': {
        id: 'travel-agent',
        label: 'Travel Agent Backend',
        publicKeyPem: travelAgentKeys.publicKeyPem
      }
    }
  });

  await app.ensureWalletIdentity();

  const request = async (pathname, { method = 'GET', body } = {}) => {
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

  const created = await request('/api/users', {
    method: 'POST',
    body: { name: 'Daemon Tester' }
  });

  const userId = created.data.user.id;
  const claimTokenResponse = await request(`/api/users/${userId}/claim-token`, {
    method: 'POST'
  });

  return {
    userId,
    claimToken: claimTokenResponse.data.activeClaimToken.token,
    request,
    travelAgentKeys
  };
}

test('wallet daemon can claim itself to a wallet account and receive a signed claim receipt', async () => {
  const harness = await createHarness();
  const daemonKeys = generateEd25519Keypair();
  const payload = {
    type: 'wallet.claim.v1',
    requestId: 'wallet_claim_req_1',
    walletInstallationId: 'wallet_install_local_1',
    walletAccountId: harness.userId,
    claimToken: harness.claimToken,
    walletPubkey: daemonKeys.publicKeyPem,
    walletLabel: 'Local daemon',
    timestamp: new Date().toISOString(),
    nonce: 'wallet_claim_nonce_1'
  };
  const signature = signPayload(payload, daemonKeys.privateKeyPem);

  const response = await harness.request('/api/wallets/claim', {
    method: 'POST',
    body: { payload, signature }
  });

  assert.equal(response.status, 200);
  assert.equal(response.data.receipt.payload.type, 'wallet.installation_receipt.v1');
  assert.equal(response.data.receipt.payload.walletInstallationId, payload.walletInstallationId);
  assert.equal(response.data.walletInstallation.ownerUserId, harness.userId);

  const meta = await harness.request('/api/meta');
  assert.equal(
    verifyPayload(response.data.receipt.payload, response.data.receipt.signature, meta.data.wallet.publicKeyPem),
    true
  );
});

test('relay delivers a signed travel-agent authorization request to the claimed wallet daemon', async () => {
  const harness = await createHarness();
  const daemonKeys = generateEd25519Keypair();
  const claimPayload = {
    type: 'wallet.claim.v1',
    requestId: 'wallet_claim_req_2',
    walletInstallationId: 'wallet_install_local_2',
    walletAccountId: harness.userId,
    claimToken: harness.claimToken,
    walletPubkey: daemonKeys.publicKeyPem,
    walletLabel: 'Local daemon',
    timestamp: new Date().toISOString(),
    nonce: 'wallet_claim_nonce_2'
  };

  await harness.request('/api/wallets/claim', {
    method: 'POST',
    body: {
      payload: claimPayload,
      signature: signPayload(claimPayload, daemonKeys.privateKeyPem)
    }
  });
  const relayPayload = {
    type: 'travel.payment_authorization_request.v1',
    requestId: 'travel_req_1',
    agentId: 'travel-agent',
    walletAccountId: harness.userId,
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_123',
    memo: 'Flight booking hold',
    timestamp: new Date().toISOString(),
    nonce: 'travel_nonce_1'
  };

  const relayEnqueue = await harness.request('/api/relay/travel-agent/requests', {
    method: 'POST',
    body: {
      payload: relayPayload,
      signature: signPayload(relayPayload, harness.travelAgentKeys.privateKeyPem)
    }
  });

  assert.equal(relayEnqueue.status, 202);

  const pollPayload = {
    type: 'wallet.relay_poll.v1',
    walletInstallationId: claimPayload.walletInstallationId,
    timestamp: new Date().toISOString(),
    nonce: 'wallet_poll_nonce_1'
  };

  const relayPoll = await harness.request('/api/relay/wallet-poll', {
    method: 'POST',
    body: {
      payload: pollPayload,
      signature: signPayload(pollPayload, daemonKeys.privateKeyPem)
    }
  });

  assert.equal(relayPoll.status, 200);
  assert.equal(relayPoll.data.requests.length, 1);
  assert.equal(relayPoll.data.requests[0].payload.requestId, relayPayload.requestId);
  assert.equal(relayPoll.data.requests[0].payload.agentId, 'travel-agent');
  assert.equal(
    verifyPayload(
      relayPoll.data.requests[0].payload,
      relayPoll.data.requests[0].signature,
      harness.travelAgentKeys.publicKeyPem
    ),
    true
  );
});

test('wallet daemon can approve a queued travel-agent request and the relay returns a wallet-signed authorization receipt', async () => {
  const harness = await createHarness();
  const daemonKeys = generateEd25519Keypair();
  const walletInstallationId = 'wallet_install_local_3';
  const claimPayload = {
    type: 'wallet.claim.v1',
    requestId: 'wallet_claim_req_3',
    walletInstallationId,
    walletAccountId: harness.userId,
    claimToken: harness.claimToken,
    walletPubkey: daemonKeys.publicKeyPem,
    walletLabel: 'Local daemon',
    timestamp: new Date().toISOString(),
    nonce: 'wallet_claim_nonce_3'
  };

  await harness.request('/api/users/' + harness.userId + '/fund', {
    method: 'POST',
    body: { amountCents: 20_000 }
  });

  await harness.request('/api/wallets/claim', {
    method: 'POST',
    body: {
      payload: claimPayload,
      signature: signPayload(claimPayload, daemonKeys.privateKeyPem)
    }
  });
  const relayPayload = {
    type: 'travel.payment_authorization_request.v1',
    requestId: 'travel_req_2',
    agentId: 'travel-agent',
    walletAccountId: harness.userId,
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_456',
    memo: 'Flight booking charge',
    timestamp: new Date().toISOString(),
    nonce: 'travel_nonce_2'
  };

  await harness.request('/api/relay/travel-agent/requests', {
    method: 'POST',
    body: {
      payload: relayPayload,
      signature: signPayload(relayPayload, harness.travelAgentKeys.privateKeyPem)
    }
  });

  const decisionPayload = {
    type: 'wallet.travel_authorization.v1',
    relayRequestId: relayPayload.requestId,
    walletInstallationId,
    walletAccountId: harness.userId,
    agentId: relayPayload.agentId,
    amount: relayPayload.amount,
    bookingReference: relayPayload.bookingReference,
    status: 'approved',
    reasonCode: 'policy_passed',
    authorizedAt: new Date().toISOString(),
    nonce: 'wallet_decision_nonce_1'
  };

  const decision = await harness.request('/api/relay/wallet-authorizations', {
    method: 'POST',
    body: {
      payload: decisionPayload,
      signature: signPayload(decisionPayload, daemonKeys.privateKeyPem)
    }
  });

  assert.equal(decision.status, 200);
  assert.equal(decision.data.receipt.payload.type, 'wallet.travel_authorization.v1');
  assert.equal(decision.data.receipt.payload.status, 'approved');

  const agentView = await harness.request(`/api/relay/travel-agent/requests/${relayPayload.requestId}`);
  assert.equal(agentView.status, 200);
  assert.equal(agentView.data.status, 'authorized');
  assert.equal(
    verifyPayload(
      agentView.data.receipt.payload,
      agentView.data.receipt.signature,
      agentView.data.walletInstallation.publicKeyPem
    ),
    true
  );
});

test('travel agent can capture an authorized request through the Stripe rail after wallet approval', async () => {
  const harness = await createHarness();
  const daemonKeys = generateEd25519Keypair();
  const walletInstallationId = 'wallet_install_local_4';
  const claimPayload = {
    type: 'wallet.claim.v1',
    requestId: 'wallet_claim_req_4',
    walletInstallationId,
    walletAccountId: harness.userId,
    claimToken: harness.claimToken,
    walletPubkey: daemonKeys.publicKeyPem,
    walletLabel: 'Local daemon',
    timestamp: new Date().toISOString(),
    nonce: 'wallet_claim_nonce_4'
  };

  await harness.request('/api/users/' + harness.userId + '/fund', {
    method: 'POST',
    body: { amountCents: 20_000 }
  });

  await harness.request('/api/wallets/claim', {
    method: 'POST',
    body: {
      payload: claimPayload,
      signature: signPayload(claimPayload, daemonKeys.privateKeyPem)
    }
  });
  const relayPayload = {
    type: 'travel.payment_authorization_request.v1',
    requestId: 'travel_req_3',
    agentId: 'travel-agent',
    walletAccountId: harness.userId,
    amount: {
      currency: 'USD',
      minor: 2450
    },
    bookingReference: 'trip_789',
    memo: 'Flight booking charge',
    timestamp: new Date().toISOString(),
    nonce: 'travel_nonce_3'
  };

  await harness.request('/api/relay/travel-agent/requests', {
    method: 'POST',
    body: {
      payload: relayPayload,
      signature: signPayload(relayPayload, harness.travelAgentKeys.privateKeyPem)
    }
  });

  const authorizationPayload = {
    type: 'wallet.travel_authorization.v1',
    relayRequestId: relayPayload.requestId,
    walletInstallationId,
    walletAccountId: harness.userId,
    agentId: relayPayload.agentId,
    amount: relayPayload.amount,
    bookingReference: relayPayload.bookingReference,
    status: 'approved',
    reasonCode: 'policy_passed',
    authorizedAt: new Date().toISOString(),
    nonce: 'wallet_decision_nonce_2'
  };

  await harness.request('/api/relay/wallet-authorizations', {
    method: 'POST',
    body: {
      payload: authorizationPayload,
      signature: signPayload(authorizationPayload, daemonKeys.privateKeyPem)
    }
  });

  const capturePayload = {
    type: 'travel.payment_capture.v1',
    relayRequestId: relayPayload.requestId,
    agentId: 'travel-agent',
    timestamp: new Date().toISOString(),
    nonce: 'travel_capture_nonce_1'
  };

  const capture = await harness.request(`/api/relay/travel-agent/requests/${relayPayload.requestId}/capture`, {
    method: 'POST',
    body: {
      payload: capturePayload,
      signature: signPayload(capturePayload, harness.travelAgentKeys.privateKeyPem)
    }
  });

  assert.equal(capture.status, 200);
  assert.equal(capture.data.charge.provider, 'mock_stripe_travel_charge');
  assert.equal(capture.data.summary.wallet.balanceCents, 17_550);

  const transaction = await harness.request(`/api/transactions/${relayPayload.requestId}`);
  assert.equal(transaction.status, 200);
  assert.equal(transaction.data.execution.provider, 'mock_stripe_travel_charge');
});
