import { createId, nowIsoTimestamp } from './ids.js';
import { signPayload, verifyPayload } from './crypto.js';

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

export function createAgentClient({ send }) {
  async function call(pathname, options) {
    const response = await send(pathname, options);
    return normalizeTransportResponse(response);
  }

  async function getWalletMeta() {
    const response = await call('/api/meta');
    return ensureOk(response, 'Failed to load wallet metadata.');
  }

  async function requestChallenge({ agentId, walletAccountId, scope = 'payment.request' }) {
    const walletMeta = await getWalletMeta();
    const response = await call('/api/agent/challenges', {
      method: 'POST',
      body: {
        agentId,
        walletAccountId,
        scope
      }
    });
    const data = ensureOk(response, 'Failed to request wallet challenge.');

    if (!verifyPayload(data.payload, data.signature, walletMeta.wallet.publicKeyPem)) {
      throw new Error('Wallet challenge signature verification failed.');
    }

    return {
      challenge: data,
      walletMeta
    };
  }

  async function claimInstallation({
    installation,
    claimToken,
    walletAccountId,
    label = installation.label
  }) {
    const walletMeta = await getWalletMeta();
    const payload = {
      type: 'agent.claim.v1',
      requestId: createId('req'),
      agentId: installation.agentId,
      walletAccountId,
      claimToken,
      agentPubkey: installation.publicKeyPem,
      agentLabel: label,
      timestamp: nowIsoTimestamp(),
      nonce: createId('nonce')
    };
    const signature = signPayload(payload, installation.privateKeyPem);

    const response = await call('/api/agent/claim', {
      method: 'POST',
      body: { payload, signature }
    });
    const data = ensureOk(response, 'Failed to claim agent installation.');

    if (!verifyPayload(data.receipt.payload, data.receipt.signature, walletMeta.wallet.publicKeyPem)) {
      throw new Error('Wallet claim receipt signature verification failed.');
    }

    if (data.receipt.payload.walletPubkey !== walletMeta.wallet.publicKeyPem) {
      throw new Error('Wallet claim receipt public key did not match wallet metadata.');
    }

    return {
      receipt: data.receipt,
      agent: data.agent,
      summary: data.summary,
      walletMeta
    };
  }

  async function requestPayment({
    installation,
    walletAccountId,
    merchantId,
    merchantDomain,
    amountMinor,
    currency = 'USD',
    memo = ''
  }) {
    const { challenge, walletMeta } = await requestChallenge({
      agentId: installation.agentId,
      walletAccountId
    });

    const payload = {
      type: 'agent.payment_request.v1',
      requestId: createId('pay'),
      challengeId: challenge.payload.challengeId,
      walletNonce: challenge.payload.walletNonce,
      agentId: installation.agentId,
      walletAccountId,
      merchantId,
      merchantDomain,
      amount: {
        currency: currency.toUpperCase(),
        minor: amountMinor
      },
      memo,
      timestamp: nowIsoTimestamp(),
      idempotencyKey: createId('idem')
    };
    const signature = signPayload(payload, installation.privateKeyPem);

    const response = await call('/api/agent/payments/request', {
      method: 'POST',
      body: { payload, signature }
    });
    const data = ensureOk(response, 'Failed to request payment.');

    if (!verifyPayload(data.payload, data.signature, walletMeta.wallet.publicKeyPem)) {
      throw new Error('Wallet payment receipt signature verification failed.');
    }

    return {
      challenge,
      receipt: data,
      walletMeta
    };
  }

  return {
    claimInstallation,
    requestChallenge,
    requestPayment
  };
}
