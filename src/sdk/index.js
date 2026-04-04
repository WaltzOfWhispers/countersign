import { nowIsoTimestamp, createId } from '../lib/ids.js';
import { signPayload, verifyPayload } from '../lib/crypto.js';
import { requestJson } from '../lib/http-client.js';

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

export function createCountersignClient({ agentId, privateKeyPem, send, baseUrl }) {
  if (!send && !baseUrl) {
    throw new Error('createCountersignClient requires either send or baseUrl.');
  }

  const normalizedBaseUrl = baseUrl ? baseUrl.replace(/\/+$/, '') : null;

  async function call(pathname, options) {
    const response = send
      ? await send(pathname, options)
      : {
          status: 200,
          data: await requestJson(`${normalizedBaseUrl}${pathname}`, options)
        };
    return normalizeTransportResponse(response);
  }

  async function enqueueAuthorizationRequest({
    walletAccountId,
    amount,
    bookingReference,
    memo,
    requestId = createId('travel_req')
  }) {
    const payload = {
      type: 'travel.payment_authorization_request.v1',
      requestId,
      agentId,
      walletAccountId,
      amount,
      bookingReference,
      memo,
      timestamp: nowIsoTimestamp(),
      nonce: createId('nonce')
    };
    const signature = signPayload(payload, privateKeyPem);

    const response = await call('/api/relay/travel-agent/requests', {
      method: 'POST',
      body: { payload, signature }
    });

    return ensureOk(response, 'Failed to enqueue authorization request.');
  }

  async function getAuthorizationResult({ relayRequestId }) {
    const response = await call(`/api/relay/travel-agent/requests/${relayRequestId}`);
    const data = ensureOk(response, 'Failed to fetch authorization result.');
    const verified =
      Boolean(data.receipt?.payload) &&
      Boolean(data.receipt?.signature) &&
      Boolean(data.walletInstallation?.publicKeyPem) &&
      verifyPayload(data.receipt.payload, data.receipt.signature, data.walletInstallation.publicKeyPem);

    if (!verified) {
      throw new Error('Wallet authorization receipt verification failed.');
    }

    return {
      ...data,
      verified
    };
  }

  async function captureAuthorizedCharge({ relayRequestId }) {
    const payload = {
      type: 'travel.payment_capture.v1',
      relayRequestId,
      agentId,
      timestamp: nowIsoTimestamp(),
      nonce: createId('nonce')
    };
    const signature = signPayload(payload, privateKeyPem);

    const response = await call(`/api/relay/travel-agent/requests/${relayRequestId}/capture`, {
      method: 'POST',
      body: { payload, signature }
    });

    return ensureOk(response, 'Failed to capture authorized charge.');
  }

  return {
    enqueueAuthorizationRequest,
    getAuthorizationResult,
    captureAuthorizedCharge
  };
}
