import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

import { generateEd25519Keypair, signPayload, verifyPayload } from './lib/crypto.js';
import { createId, nowIsoTimestamp } from './lib/ids.js';
import { runMockCrossmintCharge, runMockStripeTopUp, runMockStripeTravelCharge } from './lib/payment-rails.js';
import { DEFAULT_POLICY, evaluatePolicy, normalizePolicy } from './lib/policy.js';
import { createStore } from './lib/store.js';

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, message, details = {}) {
  sendJson(response, statusCode, { error: message, ...details });
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large.'));
        request.destroy();
      }
    });

    request.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });

    request.on('error', reject);
  });
}

function isFreshTimestamp(timestamp, { maxAgeMs = 5 * 60_000, futureSkewMs = 60_000 } = {}) {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  const delta = Date.now() - parsed.getTime();
  return delta >= -futureSkewMs && delta <= maxAgeMs;
}

function getApprovedTransactionsForUser(store, userId, excludeId) {
  return Object.values(store.paymentRequests).filter(
    (payment) =>
      payment.userId === userId &&
      payment.status === 'approved' &&
      payment.id !== excludeId
  );
}

function getActiveClaimToken(store, userId) {
  const now = Date.now();

  return Object.values(store.claimTokens)
    .filter(
      (token) =>
        token.userId === userId &&
        token.status === 'active' &&
        new Date(token.expiresAt).getTime() > now
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function getLatestWalletInstallationForUser(store, userId) {
  return Object.values(store.walletInstallations || {})
    .filter((installation) => installation.ownerUserId === userId)
    .sort((left, right) => right.claimedAt.localeCompare(left.claimedAt))[0];
}

function buildUserSummary(store, userId) {
  const user = store.users[userId];
  if (!user) {
    return null;
  }

  const agents = Object.values(store.agents)
    .filter((agent) => agent.ownerUserId === userId)
    .sort((left, right) => right.claimedAt.localeCompare(left.claimedAt));

  const transactions = Object.values(store.paymentRequests)
    .filter((payment) => payment.userId === userId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const walletInstallations = Object.values(store.walletInstallations || {})
    .filter((installation) => installation.ownerUserId === userId)
    .sort((left, right) => right.claimedAt.localeCompare(left.claimedAt));

  const activeClaimToken = getActiveClaimToken(store, userId);

  return {
    user: {
      id: user.id,
      name: user.name,
      createdAt: user.createdAt
    },
    wallet: user.wallet,
    walletInstallations,
    agents,
    activeClaimToken: activeClaimToken
      ? {
          token: activeClaimToken.token,
          expiresAt: activeClaimToken.expiresAt,
          createdAt: activeClaimToken.createdAt
        }
      : null,
    pendingApprovals: transactions.filter((payment) => payment.status === 'pending_approval'),
    transactions
  };
}

function signedWalletEnvelope(walletIdentity, payload) {
  return {
    payload,
    signature: signPayload(payload, walletIdentity.privateKeyPem)
  };
}

function createUserRecord(name) {
  return {
    id: createId('user'),
    name: name?.trim() || 'Demo user',
    createdAt: nowIsoTimestamp(),
    wallet: {
      balanceCents: 0,
      fundingEvents: [],
      policy: { ...DEFAULT_POLICY }
    }
  };
}

export function createAgentWalletApp({
  dataFile = join(process.cwd(), 'data', 'store.json'),
  publicDir = join(process.cwd(), 'public'),
  trustedAgents = {}
} = {}) {
  const storeApi = createStore(dataFile);

  async function ensureWalletIdentity() {
    await storeApi.updateStore((store) => {
      if (store.walletIdentity) {
        return;
      }

      store.walletIdentity = {
        ...generateEd25519Keypair(),
        createdAt: nowIsoTimestamp()
      };
    });
  }

  async function serveStatic(pathname, response) {
    const filePath =
      pathname === '/'
        ? join(publicDir, 'index.html')
        : join(publicDir, normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, ''));

    try {
      const body = await readFile(filePath);
      const mimeType =
        {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.json': 'application/json; charset=utf-8'
        }[extname(filePath)] || 'application/octet-stream';

      response.writeHead(200, { 'content-type': mimeType });
      response.end(body);
    } catch {
      sendError(response, 404, 'Not found.');
    }
  }

  async function routeRequest({ method, pathname, body = {} }) {
    try {
      if (method === 'GET' && pathname === '/api/meta') {
        const store = await storeApi.readStore();
        return {
          statusCode: 200,
          payload: {
          wallet: {
            keyId: store.walletIdentity.keyId,
            publicKeyPem: store.walletIdentity.publicKeyPem
          },
          defaults: {
            policy: DEFAULT_POLICY
          },
          serverTime: nowIsoTimestamp()
          }
        };
      }

      if (method === 'POST' && pathname === '/api/users') {
        const { store, result } = await storeApi.updateStore((store) => {
          const user = createUserRecord(body.name);
          store.users[user.id] = user;
          return { userId: user.id };
        });

        return { statusCode: 201, payload: buildUserSummary(store, result.userId) };
      }

      const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
      if (method === 'GET' && userMatch) {
        const store = await storeApi.readStore();
        const summary = buildUserSummary(store, userMatch[1]);
        if (!summary) {
          return { statusCode: 404, payload: { error: 'User not found.' } };
        }

        return { statusCode: 200, payload: summary };
      }

      const fundMatch = pathname.match(/^\/api\/users\/([^/]+)\/fund$/);
      if (method === 'POST' && fundMatch) {
        const amountCents = Math.round(Number(body.amountCents));

        if (!Number.isInteger(amountCents) || amountCents <= 0) {
          return {
            statusCode: 400,
            payload: { error: 'Funding amount must be a positive integer in cents.' }
          };
        }

        const { store } = await storeApi.updateStore((store) => {
          const user = store.users[fundMatch[1]];
          if (!user) {
            throw new Error('USER_NOT_FOUND');
          }

          const fundingEvent = runMockStripeTopUp({ amountCents });
          user.wallet.balanceCents += amountCents;
          user.wallet.fundingEvents.unshift(fundingEvent);
        });

        return { statusCode: 200, payload: buildUserSummary(store, fundMatch[1]) };
      }

      const policyMatch = pathname.match(/^\/api\/users\/([^/]+)\/policy$/);
      if (method === 'PUT' && policyMatch) {
        const { store } = await storeApi.updateStore((store) => {
          const user = store.users[policyMatch[1]];
          if (!user) {
            throw new Error('USER_NOT_FOUND');
          }

          user.wallet.policy = normalizePolicy(body);
        });

        return { statusCode: 200, payload: buildUserSummary(store, policyMatch[1]) };
      }

      const claimTokenMatch = pathname.match(/^\/api\/users\/([^/]+)\/claim-token$/);
      if (method === 'POST' && claimTokenMatch) {
        const { store } = await storeApi.updateStore((store) => {
          const user = store.users[claimTokenMatch[1]];
          if (!user) {
            throw new Error('USER_NOT_FOUND');
          }

          const tokenId = createId('claim');
          store.claimTokens[tokenId] = {
            id: tokenId,
            token: createId('token'),
            userId: user.id,
            status: 'active',
            createdAt: nowIsoTimestamp(),
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
          };
        });

        return { statusCode: 201, payload: buildUserSummary(store, claimTokenMatch[1]) };
      }

      if (method === 'POST' && pathname === '/api/wallets/claim') {
        const { payload, signature } = body;

        if (!payload || !signature) {
          return { statusCode: 400, payload: { error: 'Wallet claim payload and signature are required.' } };
        }

        if (!payload.walletInstallationId || !payload.walletAccountId || !payload.claimToken || !payload.walletPubkey) {
          return { statusCode: 400, payload: { error: 'Wallet claim payload is missing required fields.' } };
        }

        if (!isFreshTimestamp(payload.timestamp)) {
          return { statusCode: 400, payload: { error: 'Wallet claim payload timestamp is stale or invalid.' } };
        }

        if (!verifyPayload(payload, signature, payload.walletPubkey)) {
          return { statusCode: 401, payload: { error: 'Wallet claim signature verification failed.' } };
        }

        const { store, result } = await storeApi.updateStore((store) => {
          const tokenRecord = Object.values(store.claimTokens).find(
            (token) => token.token === payload.claimToken
          );

          if (!tokenRecord || tokenRecord.status !== 'active') {
            return { error: 'Claim token is invalid or already used.', statusCode: 403 };
          }

          if (tokenRecord.userId !== payload.walletAccountId) {
            return { error: 'Claim token does not belong to that wallet account.', statusCode: 403 };
          }

          if (new Date(tokenRecord.expiresAt).getTime() <= Date.now()) {
            tokenRecord.status = 'expired';
            return { error: 'Claim token has expired.', statusCode: 403 };
          }

          const existingInstallation = store.walletInstallations[payload.walletInstallationId];
          if (existingInstallation && existingInstallation.ownerUserId !== payload.walletAccountId) {
            return { error: 'Wallet installation is already claimed by another wallet account.', statusCode: 409 };
          }

          if (existingInstallation && existingInstallation.publicKeyPem !== payload.walletPubkey) {
            return { error: 'Wallet installation id already exists with a different public key.', statusCode: 409 };
          }

          const walletInstallation = existingInstallation || {
            id: payload.walletInstallationId,
            createdAt: nowIsoTimestamp()
          };

          walletInstallation.label =
            payload.walletLabel?.trim() || walletInstallation.label || payload.walletInstallationId;
          walletInstallation.publicKeyPem = payload.walletPubkey;
          walletInstallation.ownerUserId = payload.walletAccountId;
          walletInstallation.claimedAt = nowIsoTimestamp();
          store.walletInstallations[payload.walletInstallationId] = walletInstallation;

          tokenRecord.status = 'used';
          tokenRecord.usedAt = nowIsoTimestamp();
          tokenRecord.walletInstallationId = payload.walletInstallationId;
          tokenRecord.requestId = payload.requestId;
          tokenRecord.nonce = payload.nonce;

          const receiptPayload = {
            type: 'wallet.installation_receipt.v1',
            requestId: payload.requestId,
            walletInstallationId: payload.walletInstallationId,
            walletAccountId: payload.walletAccountId,
            status: 'claimed',
            relayKeyId: store.walletIdentity.keyId,
            relayPubkey: store.walletIdentity.publicKeyPem,
            claimedAt: nowIsoTimestamp()
          };

          return { walletInstallation, userId: payload.walletAccountId, receiptPayload };
        });

        if (result.error) {
          return { statusCode: result.statusCode, payload: { error: result.error } };
        }

        return {
          statusCode: 200,
          payload: {
            receipt: signedWalletEnvelope(store.walletIdentity, result.receiptPayload),
            walletInstallation: result.walletInstallation,
            summary: buildUserSummary(store, result.userId)
          }
        };
      }

      if (method === 'POST' && pathname === '/api/relay/travel-agent/requests') {
        const { payload, signature } = body;

        if (!payload || !signature) {
          return {
            statusCode: 400,
            payload: { error: 'Relay request payload and signature are required.' }
          };
        }

        if (!payload.requestId || !payload.agentId || !payload.walletAccountId || !payload.amount?.minor) {
          return {
            statusCode: 400,
            payload: { error: 'Relay request payload is missing required fields.' }
          };
        }

        if (!isFreshTimestamp(payload.timestamp)) {
          return {
            statusCode: 400,
            payload: { error: 'Relay request timestamp is stale or invalid.' }
          };
        }

        const trustedAgent = trustedAgents[payload.agentId];
        if (!trustedAgent) {
          return {
            statusCode: 403,
            payload: { error: 'Remote agent is not trusted by this relay.' }
          };
        }

        if (!verifyPayload(payload, signature, trustedAgent.publicKeyPem)) {
          return {
            statusCode: 401,
            payload: { error: 'Relay request signature verification failed.' }
          };
        }

        const { result } = await storeApi.updateStore((store) => {
          if (store.relayRequests[payload.requestId]) {
            return { error: 'Relay request id has already been used.', statusCode: 409 };
          }

          const walletAccount = store.users[payload.walletAccountId];
          if (!walletAccount) {
            return { error: 'Wallet account not found.', statusCode: 404 };
          }

          const walletInstallation = getLatestWalletInstallationForUser(store, payload.walletAccountId);
          if (!walletInstallation) {
            return { error: 'No claimed wallet installation is available for that wallet account.', statusCode: 409 };
          }

          store.relayRequests[payload.requestId] = {
            id: payload.requestId,
            walletAccountId: payload.walletAccountId,
            walletInstallationId: walletInstallation.id,
            agentId: payload.agentId,
            payload,
            signature,
            status: 'pending_wallet',
            createdAt: nowIsoTimestamp()
          };

          return {
            relayRequestId: payload.requestId,
            walletInstallationId: walletInstallation.id,
            status: 'pending_wallet'
          };
        });

        if (result.error) {
          return { statusCode: result.statusCode, payload: { error: result.error } };
        }

        return {
          statusCode: 202,
          payload: result
        };
      }

      if (method === 'POST' && pathname === '/api/relay/wallet-poll') {
        const { payload, signature } = body;

        if (!payload || !signature) {
          return {
            statusCode: 400,
            payload: { error: 'Wallet poll payload and signature are required.' }
          };
        }

        if (!payload.walletInstallationId) {
          return {
            statusCode: 400,
            payload: { error: 'Wallet poll payload is missing required fields.' }
          };
        }

        if (!isFreshTimestamp(payload.timestamp)) {
          return {
            statusCode: 400,
            payload: { error: 'Wallet poll timestamp is stale or invalid.' }
          };
        }

        const store = await storeApi.readStore();
        const walletInstallation = store.walletInstallations[payload.walletInstallationId];
        if (!walletInstallation) {
          return {
            statusCode: 404,
            payload: { error: 'Wallet installation not found.' }
          };
        }

        if (!verifyPayload(payload, signature, walletInstallation.publicKeyPem)) {
          return {
            statusCode: 401,
            payload: { error: 'Wallet poll signature verification failed.' }
          };
        }

        const requests = Object.values(store.relayRequests || {})
          .filter(
            (relayRequest) =>
              relayRequest.walletInstallationId === payload.walletInstallationId &&
              relayRequest.status === 'pending_wallet'
          )
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .map((relayRequest) => ({
            requestId: relayRequest.id,
            payload: relayRequest.payload,
            signature: relayRequest.signature
          }));

        return {
          statusCode: 200,
          payload: {
            walletInstallationId: payload.walletInstallationId,
            requests
          }
        };
      }

      if (method === 'POST' && pathname === '/api/relay/wallet-authorizations') {
        const { payload, signature } = body;

        if (!payload || !signature) {
          return {
            statusCode: 400,
            payload: { error: 'Wallet authorization payload and signature are required.' }
          };
        }

        if (!payload.relayRequestId || !payload.walletInstallationId || !payload.status) {
          return {
            statusCode: 400,
            payload: { error: 'Wallet authorization payload is missing required fields.' }
          };
        }

        const store = await storeApi.readStore();
        const walletInstallation = store.walletInstallations[payload.walletInstallationId];
        if (!walletInstallation) {
          return {
            statusCode: 404,
            payload: { error: 'Wallet installation not found.' }
          };
        }

        if (!verifyPayload(payload, signature, walletInstallation.publicKeyPem)) {
          return {
            statusCode: 401,
            payload: { error: 'Wallet authorization signature verification failed.' }
          };
        }

        const { store: updatedStore, result } = await storeApi.updateStore((store) => {
          const relayRequest = store.relayRequests[payload.relayRequestId];
          if (!relayRequest) {
            return { error: 'Relay request not found.', statusCode: 404 };
          }

          if (relayRequest.status !== 'pending_wallet') {
            return { error: 'Relay request is not pending wallet authorization.', statusCode: 409 };
          }

          if (relayRequest.walletInstallationId !== payload.walletInstallationId) {
            return { error: 'Relay request does not belong to that wallet installation.', statusCode: 403 };
          }

          const user = store.users[relayRequest.walletAccountId];
          if (!user) {
            return { error: 'Wallet account not found.', statusCode: 404 };
          }

          const amountCents = Math.round(Number(relayRequest.payload.amount?.minor));
          const serviceId = String(relayRequest.payload.agentId).trim();
          const approvedTransactions = getApprovedTransactionsForUser(store, user.id);
          const evaluation = evaluatePolicy({
            policy: user.wallet.policy,
            approvedTransactions,
            balanceCents: user.wallet.balanceCents,
            amountCents,
            merchant: serviceId,
            requestedAt: relayRequest.payload.timestamp,
            skipApprovalThreshold: payload.status === 'approved'
          });

          if (payload.status === 'approved' && evaluation.decision !== 'approve') {
            return {
              error: `Authorization failed ${evaluation.reason}.`,
              statusCode: 409
            };
          }

          relayRequest.status = payload.status === 'approved' ? 'authorized' : 'rejected';
          relayRequest.walletAuthorization = {
            payload,
            signature
          };
          relayRequest.updatedAt = nowIsoTimestamp();

          const payment = {
            id: relayRequest.id,
            userId: user.id,
            agentId: relayRequest.agentId,
            label: relayRequest.payload.memo?.trim() || relayRequest.payload.agentId,
            merchant: serviceId,
            amountCents,
            currency: String(relayRequest.payload.amount?.currency || 'USD').toUpperCase(),
            createdAt: relayRequest.createdAt,
            requestedAt: relayRequest.payload.timestamp,
            status: relayRequest.status === 'authorized' ? 'approved' : 'rejected',
            reason: payload.reasonCode || (relayRequest.status === 'authorized' ? 'policy_passed' : 'rejected_by_wallet'),
            policySnapshot: user.wallet.policy,
            daySpendCents: evaluation.daySpendCents
          };

          store.paymentRequests[payment.id] = payment;

          return {
            receipt: relayRequest.walletAuthorization,
            relayRequestId: relayRequest.id,
            status: relayRequest.status,
            walletInstallation
          };
        });

        if (result.error) {
          return { statusCode: result.statusCode, payload: { error: result.error } };
        }

        return {
          statusCode: 200,
          payload: {
            receipt: result.receipt,
            relayRequestId: result.relayRequestId,
            status: result.status,
            walletInstallation: result.walletInstallation
          }
        };
      }

      const relayRequestMatch = pathname.match(/^\/api\/relay\/travel-agent\/requests\/([^/]+)$/);
      if (method === 'GET' && relayRequestMatch) {
        const store = await storeApi.readStore();
        const relayRequest = store.relayRequests[relayRequestMatch[1]];
        if (!relayRequest) {
          return {
            statusCode: 404,
            payload: { error: 'Relay request not found.' }
          };
        }

        const walletInstallation = store.walletInstallations[relayRequest.walletInstallationId];

        return {
          statusCode: 200,
          payload: {
            requestId: relayRequest.id,
            status: relayRequest.status,
            receipt: relayRequest.walletAuthorization || null,
            walletInstallation: walletInstallation || null
          }
        };
      }

      const relayCaptureMatch = pathname.match(/^\/api\/relay\/travel-agent\/requests\/([^/]+)\/capture$/);
      if (method === 'POST' && relayCaptureMatch) {
        const { payload, signature } = body;

        if (!payload || !signature) {
          return {
            statusCode: 400,
            payload: { error: 'Travel capture payload and signature are required.' }
          };
        }

        if (!payload.relayRequestId || !payload.agentId) {
          return {
            statusCode: 400,
            payload: { error: 'Travel capture payload is missing required fields.' }
          };
        }

        if (!isFreshTimestamp(payload.timestamp)) {
          return {
            statusCode: 400,
            payload: { error: 'Travel capture timestamp is stale or invalid.' }
          };
        }

        const trustedAgent = trustedAgents[payload.agentId];
        if (!trustedAgent) {
          return {
            statusCode: 403,
            payload: { error: 'Remote agent is not trusted by this relay.' }
          };
        }

        if (!verifyPayload(payload, signature, trustedAgent.publicKeyPem)) {
          return {
            statusCode: 401,
            payload: { error: 'Travel capture signature verification failed.' }
          };
        }

        const { store, result } = await storeApi.updateStore((store) => {
          const relayRequest = store.relayRequests[relayCaptureMatch[1]];
          if (!relayRequest) {
            return { error: 'Relay request not found.', statusCode: 404 };
          }

          if (relayRequest.id !== payload.relayRequestId) {
            return { error: 'Travel capture request id mismatch.', statusCode: 409 };
          }

          if (relayRequest.agentId !== payload.agentId) {
            return { error: 'Travel capture agent mismatch.', statusCode: 403 };
          }

          if (relayRequest.status !== 'authorized') {
            return { error: 'Relay request is not authorized for capture.', statusCode: 409 };
          }

          const user = store.users[relayRequest.walletAccountId];
          if (!user) {
            return { error: 'Wallet account not found.', statusCode: 404 };
          }

          const amountCents = Math.round(Number(relayRequest.payload.amount?.minor));
          if (user.wallet.balanceCents < amountCents) {
            return { error: 'Insufficient wallet balance for capture.', statusCode: 409 };
          }

          const charge = runMockStripeTravelCharge({
            amountCents,
            currency: relayRequest.payload.amount?.currency || 'USD',
            walletAccountId: relayRequest.walletAccountId,
            agentId: relayRequest.agentId,
            relayRequestId: relayRequest.id
          });

          user.wallet.balanceCents -= amountCents;
          relayRequest.status = 'captured';
          relayRequest.capture = {
            payload,
            signature,
            charge
          };
          relayRequest.updatedAt = nowIsoTimestamp();

          const payment = store.paymentRequests[relayRequest.id];
          if (payment) {
            payment.execution = charge;
            payment.capturedAt = charge.createdAt;
          }

          return {
            charge,
            summary: buildUserSummary(store, relayRequest.walletAccountId)
          };
        });

        if (result.error) {
          return { statusCode: result.statusCode, payload: { error: result.error } };
        }

        return {
          statusCode: 200,
          payload: result
        };
      }

      if (method === 'POST' && pathname === '/api/agent/claim') {
        const { payload, signature } = body;

        if (!payload || !signature) {
          return { statusCode: 400, payload: { error: 'Claim payload and signature are required.' } };
        }

        if (!payload.agentId || !payload.claimToken || !payload.agentPubkey) {
          return { statusCode: 400, payload: { error: 'Claim payload is missing required fields.' } };
        }

        if (!isFreshTimestamp(payload.timestamp)) {
          return { statusCode: 400, payload: { error: 'Claim payload timestamp is stale or invalid.' } };
        }

        if (!verifyPayload(payload, signature, payload.agentPubkey)) {
          return { statusCode: 401, payload: { error: 'Claim signature verification failed.' } };
        }

        const { store, result } = await storeApi.updateStore((store) => {
          if (Object.values(store.claimTokens).some((token) => token.requestId === payload.requestId)) {
            return { error: 'Claim request id has already been used.', statusCode: 409 };
          }

          const tokenRecord = Object.values(store.claimTokens).find(
            (token) => token.token === payload.claimToken
          );

          if (!tokenRecord || tokenRecord.status !== 'active') {
            return { error: 'Claim token is invalid or already used.', statusCode: 403 };
          }

          if (new Date(tokenRecord.expiresAt).getTime() <= Date.now()) {
            tokenRecord.status = 'expired';
            return { error: 'Claim token has expired.', statusCode: 403 };
          }

          const existingAgent = store.agents[payload.agentId];
          if (existingAgent && existingAgent.ownerUserId && existingAgent.ownerUserId !== tokenRecord.userId) {
            return { error: 'Agent is already claimed by another wallet.', statusCode: 409 };
          }

          if (existingAgent && existingAgent.publicKeyPem !== payload.agentPubkey) {
            return { error: 'Agent id already exists with a different public key.', statusCode: 409 };
          }

          const agent = existingAgent || {
            id: payload.agentId,
            createdAt: nowIsoTimestamp()
          };

          agent.label = payload.agentLabel?.trim() || agent.label || payload.agentId;
          agent.publicKeyPem = payload.agentPubkey;
          agent.ownerUserId = tokenRecord.userId;
          agent.claimedAt = nowIsoTimestamp();
          store.agents[payload.agentId] = agent;

          tokenRecord.status = 'used';
          tokenRecord.usedAt = nowIsoTimestamp();
          tokenRecord.agentId = payload.agentId;
          tokenRecord.requestId = payload.requestId;
          tokenRecord.nonce = payload.nonce;

          const receiptPayload = {
            type: 'wallet.claim_receipt.v1',
            requestId: payload.requestId,
            agentId: payload.agentId,
            walletAccountId: tokenRecord.userId,
            status: 'claimed',
            walletKeyId: store.walletIdentity.keyId,
            walletPubkey: store.walletIdentity.publicKeyPem,
            claimedAt: nowIsoTimestamp()
          };

          return { receiptPayload, userId: tokenRecord.userId, agent };
        });

        if (result.error) {
          return { statusCode: result.statusCode, payload: { error: result.error } };
        }

        return {
          statusCode: 200,
          payload: {
            receipt: signedWalletEnvelope(store.walletIdentity, result.receiptPayload),
            agent: result.agent,
            summary: buildUserSummary(store, result.userId)
          }
        };
      }

      if (method === 'POST' && pathname === '/api/agent/challenges') {
        const { agentId, walletAccountId, scope = 'payment.request' } = body;

        if (!agentId || !walletAccountId) {
          return { statusCode: 400, payload: { error: 'agentId and walletAccountId are required.' } };
        }

        const { store, result } = await storeApi.updateStore((store) => {
          const agent = store.agents[agentId];
          if (!agent || agent.ownerUserId !== walletAccountId) {
            return { error: 'Agent is not claimed by that wallet.', statusCode: 403 };
          }

          const challengeId = createId('chl');
          const payload = {
            type: 'wallet.challenge.v1',
            challengeId,
            agentId,
            walletAccountId,
            scope,
            walletNonce: createId('wn'),
            issuedAt: nowIsoTimestamp(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            walletKeyId: store.walletIdentity.keyId
          };

          store.challenges[challengeId] = {
            id: challengeId,
            agentId,
            walletAccountId,
            scope,
            walletNonce: payload.walletNonce,
            issuedAt: payload.issuedAt,
            expiresAt: payload.expiresAt,
            status: 'active'
          };

          return { envelope: signedWalletEnvelope(store.walletIdentity, payload) };
        });

        if (result.error) {
          return { statusCode: result.statusCode, payload: { error: result.error } };
        }

        return { statusCode: 201, payload: result.envelope };
      }

      if (method === 'POST' && pathname === '/api/agent/payments/request') {
        const { payload, signature } = body;

        if (!payload || !signature) {
          return { statusCode: 400, payload: { error: 'Payment payload and signature are required.' } };
        }

        if (!payload.agentId || !payload.requestId || !payload.merchantId || !payload.challengeId) {
          return { statusCode: 400, payload: { error: 'Payment payload is missing required fields.' } };
        }

        if (!isFreshTimestamp(payload.timestamp)) {
          return { statusCode: 400, payload: { error: 'Payment payload timestamp is stale or invalid.' } };
        }

        const { store, result } = await storeApi.updateStore((store) => {
          if (store.paymentRequests[payload.requestId]) {
            return { error: 'Payment request id has already been used.', statusCode: 409 };
          }

          const agent = store.agents[payload.agentId];
          if (!agent || !agent.ownerUserId) {
            return { error: 'Agent is not registered to a wallet.', statusCode: 403 };
          }

          if (!verifyPayload(payload, signature, agent.publicKeyPem)) {
            return { error: 'Payment signature verification failed.', statusCode: 401 };
          }

          const challenge = store.challenges[payload.challengeId];
          if (!challenge || challenge.status !== 'active') {
            return { error: 'Challenge is invalid or already used.', statusCode: 403 };
          }

          if (challenge.agentId !== agent.id || challenge.walletAccountId !== agent.ownerUserId) {
            return { error: 'Challenge does not match the claimed agent wallet binding.', statusCode: 403 };
          }

          if (challenge.walletNonce !== payload.walletNonce) {
            return { error: 'Challenge nonce mismatch.', statusCode: 403 };
          }

          if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
            challenge.status = 'expired';
            return { error: 'Challenge has expired.', statusCode: 403 };
          }

          const user = store.users[agent.ownerUserId];
          if (!user) {
            return { error: 'Wallet owner not found.', statusCode: 404 };
          }

          const amountCents = Math.round(Number(payload.amount?.minor));
          const merchant = String(payload.merchantId).trim();
          const approvedTransactions = getApprovedTransactionsForUser(store, user.id);
          const evaluation = evaluatePolicy({
            policy: user.wallet.policy,
            approvedTransactions,
            balanceCents: user.wallet.balanceCents,
            amountCents,
            merchant,
            requestedAt: payload.timestamp
          });

          const payment = {
            id: payload.requestId,
            userId: user.id,
            agentId: agent.id,
            challengeId: payload.challengeId,
            label: payload.memo?.trim() || merchant,
            merchant,
            amountCents,
            currency: String(payload.amount?.currency || 'USD').toUpperCase(),
            createdAt: nowIsoTimestamp(),
            requestedAt: payload.timestamp,
            status:
              evaluation.decision === 'approve'
                ? 'approved'
                : evaluation.decision === 'pending_approval'
                  ? 'pending_approval'
                  : 'rejected',
            reason: evaluation.reason,
            policySnapshot: user.wallet.policy,
            daySpendCents: evaluation.daySpendCents
          };

          challenge.status = 'used';
          challenge.usedAt = nowIsoTimestamp();
          challenge.requestId = payload.requestId;

          if (evaluation.decision === 'approve') {
            const execution = runMockCrossmintCharge({
              merchant,
              amountCents,
              currency: payment.currency
            });

            payment.execution = execution;
            payment.approvedAt = nowIsoTimestamp();
            user.wallet.balanceCents -= amountCents;
          }

          store.paymentRequests[payment.id] = payment;

          const receiptPayload = {
            type: 'wallet.payment_receipt.v1',
            requestId: payload.requestId,
            challengeId: payload.challengeId,
            agentId: agent.id,
            walletAccountId: user.id,
            status: payment.status,
            reasonCode: payment.reason,
            providerRef: payment.execution?.providerReference || null,
            balanceRemaining: {
              currency: payment.currency,
              minor: user.wallet.balanceCents
            },
            processedAt: nowIsoTimestamp(),
            walletKeyId: store.walletIdentity.keyId
          };

          return { receiptPayload };
        });

        if (result.error) {
          return { statusCode: result.statusCode, payload: { error: result.error } };
        }

        return {
          statusCode: 200,
          payload: signedWalletEnvelope(store.walletIdentity, result.receiptPayload)
        };
      }

      const approvalMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|reject)$/);
      if (method === 'POST' && approvalMatch) {
        const paymentId = approvalMatch[1];
        const action = approvalMatch[2];

        const { store, result } = await storeApi.updateStore((store) => {
          const payment = store.paymentRequests[paymentId];
          if (!payment) {
            return { error: 'Payment request not found.', statusCode: 404 };
          }

          if (payment.status !== 'pending_approval') {
            return { error: 'Payment request is not pending approval.', statusCode: 409 };
          }

          if (action === 'reject') {
            payment.status = 'rejected';
            payment.reason = 'rejected_by_user';
            payment.updatedAt = nowIsoTimestamp();
            const receiptPayload = {
              type: 'wallet.payment_finalized.v1',
              requestId: payment.id,
              agentId: payment.agentId,
              status: 'rejected',
              reasonCode: payment.reason,
              providerRef: null,
              processedAt: payment.updatedAt
            };
            return { userId: payment.userId, payment, receiptPayload };
          }

          const user = store.users[payment.userId];
          const approvedTransactions = getApprovedTransactionsForUser(store, user.id, payment.id);
          const evaluation = evaluatePolicy({
            policy: user.wallet.policy,
            approvedTransactions,
            balanceCents: user.wallet.balanceCents,
            amountCents: payment.amountCents,
            merchant: payment.merchant,
            requestedAt: nowIsoTimestamp(),
            skipApprovalThreshold: true
          });

          if (evaluation.decision !== 'approve') {
            payment.status = 'rejected';
            payment.reason = `approval_failed_${evaluation.reason}`;
            payment.updatedAt = nowIsoTimestamp();
            const receiptPayload = {
              type: 'wallet.payment_finalized.v1',
              requestId: payment.id,
              agentId: payment.agentId,
              status: 'rejected',
              reasonCode: payment.reason,
              providerRef: null,
              processedAt: payment.updatedAt
            };
            return { userId: payment.userId, payment, receiptPayload };
          }

          const execution = runMockCrossmintCharge({
            merchant: payment.merchant,
            amountCents: payment.amountCents,
            currency: payment.currency
          });

          payment.status = 'approved';
          payment.reason = 'approved_by_user';
          payment.execution = execution;
          payment.approvedAt = nowIsoTimestamp();
          payment.updatedAt = nowIsoTimestamp();
          user.wallet.balanceCents -= payment.amountCents;

          const receiptPayload = {
            type: 'wallet.payment_finalized.v1',
            requestId: payment.id,
            agentId: payment.agentId,
            status: 'approved',
            reasonCode: payment.reason,
            providerRef: execution.providerReference,
            processedAt: payment.updatedAt
          };

          return { userId: payment.userId, payment, receiptPayload };
        });

        if (result.error) {
          return { statusCode: result.statusCode, payload: { error: result.error } };
        }

        return {
          statusCode: 200,
          payload: {
            payment: result.payment,
            receipt: signedWalletEnvelope(store.walletIdentity, result.receiptPayload),
            summary: buildUserSummary(store, result.userId)
          }
        };
      }

      const transactionMatch = pathname.match(/^\/api\/transactions\/([^/]+)$/);
      if (method === 'GET' && transactionMatch) {
        const store = await storeApi.readStore();
        const payment = store.paymentRequests[transactionMatch[1]];
        if (!payment) {
          return { statusCode: 404, payload: { error: 'Transaction not found.' } };
        }

        return { statusCode: 200, payload: payment };
      }
      
      return { statusCode: 404, payload: { error: 'Not found.' } };
    } catch (error) {
      if (error.message === 'USER_NOT_FOUND') {
        return { statusCode: 404, payload: { error: 'User not found.' } };
      }

      return {
        statusCode: 500,
        payload: { error: 'Internal server error.', detail: error.message }
      };
    }
  }

  async function handleRequest(request, response) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const { pathname } = url;

    if (!pathname.startsWith('/api/')) {
      await serveStatic(pathname, response);
      return;
    }

    const body = ['POST', 'PUT', 'PATCH'].includes(request.method) ? await parseBody(request) : {};
    const result = await routeRequest({
      method: request.method,
      pathname,
      body
    });

    sendJson(response, result.statusCode, result.payload);
  }

  async function start({ port = 3000, host = '0.0.0.0' } = {}) {
    await ensureWalletIdentity();

    const server = createServer(handleRequest);

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });

    return server;
  }

  return {
    dataFile,
    storeApi,
    ensureWalletIdentity,
    routeRequest,
    handleRequest,
    start
  };
}
