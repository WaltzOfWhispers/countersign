import { nowIsoTimestamp, createId } from './ids.js';
import { signPayload, verifyPayload } from './crypto.js';
import { runMockStripeWalletCharge } from './payment-rails.js';

function ensureOk(response, fallbackMessage) {
  if (response.status >= 200 && response.status < 300) {
    return response.data;
  }

  throw new Error(response.data?.error || fallbackMessage);
}

function normalizeTransportResponse(response) {
  if (response && typeof response.status === 'number' && 'data' in response) {
    return response;
  }

  if (response && typeof response.statusCode === 'number' && 'payload' in response) {
    return {
      status: response.statusCode,
      data: response.payload
    };
  }

  throw new Error('Transport returned an unexpected response shape.');
}

export function createWalletDaemonClient({ send }) {
  async function call(pathname, options) {
    const response = await send(pathname, options);
    return normalizeTransportResponse(response);
  }

  async function getRelayMeta() {
    const response = await call('/api/meta');
    return ensureOk(response, 'Failed to load relay metadata.');
  }

  async function claimInstallation({
    installation,
    walletAccountId,
    claimToken,
    label = installation.label
  }) {
    const relayMeta = await getRelayMeta();
    const payload = {
      type: 'wallet.claim.v1',
      requestId: createId('wallet_claim'),
      walletInstallationId: installation.walletInstallationId,
      walletAccountId,
      claimToken,
      walletPubkey: installation.publicKeyPem,
      walletLabel: label,
      timestamp: nowIsoTimestamp(),
      nonce: createId('nonce')
    };
    const signature = signPayload(payload, installation.privateKeyPem);

    const response = await call('/api/wallets/claim', {
      method: 'POST',
      body: { payload, signature }
    });
    const data = ensureOk(response, 'Failed to claim wallet installation.');

    if (!verifyPayload(data.receipt.payload, data.receipt.signature, relayMeta.wallet.publicKeyPem)) {
      throw new Error('Relay-signed wallet installation receipt verification failed.');
    }

    return {
      receipt: data.receipt,
      walletInstallation: data.walletInstallation,
      summary: data.summary,
      relayMeta
    };
  }

  async function pollRequests({ installation }) {
    const payload = {
      type: 'wallet.relay_poll.v1',
      walletInstallationId: installation.walletInstallationId,
      timestamp: nowIsoTimestamp(),
      nonce: createId('nonce')
    };
    const signature = signPayload(payload, installation.privateKeyPem);

    const response = await call('/api/relay/wallet-poll', {
      method: 'POST',
      body: { payload, signature }
    });

    return ensureOk(response, 'Failed to poll relay requests.');
  }

  async function authorizeRequest({
    installation,
    relayRequest,
    walletAccountId,
    status = 'approved',
    reasonCode = 'policy_passed'
  }) {
    const execution =
      status === 'approved' && installation.paymentMethod
        ? runMockStripeWalletCharge({
            amountCents: Math.round(Number(relayRequest.payload.amount?.minor)),
            currency: relayRequest.payload.amount?.currency || 'USD',
            walletAccountId,
            agentId: relayRequest.payload.agentId,
            relayRequestId: relayRequest.requestId,
            paymentMethod: installation.paymentMethod
          })
        : undefined;

    const payload = {
      type: 'wallet.travel_authorization.v1',
      relayRequestId: relayRequest.requestId,
      walletInstallationId: installation.walletInstallationId,
      walletAccountId,
      agentId: relayRequest.payload.agentId,
      amount: relayRequest.payload.amount,
      bookingReference: relayRequest.payload.bookingReference,
      status,
      reasonCode,
      authorizedAt: nowIsoTimestamp(),
      nonce: createId('nonce'),
      execution
    };
    const signature = signPayload(payload, installation.privateKeyPem);

    const response = await call('/api/relay/wallet-authorizations', {
      method: 'POST',
      body: { payload, signature }
    });
    const data = ensureOk(response, 'Failed to submit wallet authorization.');

    if (!verifyPayload(data.receipt.payload, data.receipt.signature, installation.publicKeyPem)) {
      throw new Error('Wallet authorization receipt verification failed.');
    }

    return data;
  }

    return {
      claimInstallation,
      pollRequests,
      authorizeRequest
    };
}
