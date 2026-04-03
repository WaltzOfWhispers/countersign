import { join } from 'node:path';

import { createAgentWalletApp } from '../app.js';
import { generateEd25519Keypair } from '../lib/crypto.js';
import { createId, nowIsoTimestamp } from '../lib/ids.js';
import { createWalletDaemonClient } from '../lib/wallet-daemon-client.js';
import { createWalletInstallationStore } from '../lib/wallet-installation-files.js';

function centsFromUsd(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive number in USD.`);
  }

  return Math.round(parsed * 100);
}

function optionalCentsFromUsd(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Policy amounts must be non-negative numbers in USD.');
  }

  return Math.round(parsed * 100);
}

function createAppTransport(app) {
  return async (pathname, { method = 'GET', body } = {}) => {
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
}

export function createCountersignControlPlane({
  dataFile = join(process.cwd(), 'data', 'store.json'),
  walletDir = join(process.cwd(), 'local-wallet'),
  trustedAgents = {}
} = {}) {
  const app = createAgentWalletApp({
    dataFile,
    trustedAgents
  });
  const send = createAppTransport(app);
  const walletClient = createWalletDaemonClient({ send });
  const walletStore = createWalletInstallationStore({ walletDir });

  async function initialize() {
    await app.ensureWalletIdentity();
  }

  async function createWallet({ name }) {
    await initialize();
    const response = await send('/api/users', {
      method: 'POST',
      body: { name }
    });

    return response.data;
  }

  async function getWallet({ walletAccountId }) {
    await initialize();
    const response = await send(`/api/users/${walletAccountId}`);
    return response.data;
  }

  async function fundWallet({ walletAccountId, amountUsd }) {
    await initialize();
    const response = await send(`/api/users/${walletAccountId}/fund`, {
      method: 'POST',
      body: { amountCents: centsFromUsd(amountUsd, 'amountUsd') }
    });

    return response.data;
  }

  async function setWalletPolicy({
    walletAccountId,
    perTransactionLimitUsd,
    dailyCapUsd,
    approvalThresholdUsd,
    allowedMerchants
  }) {
    await initialize();
    const response = await send(`/api/users/${walletAccountId}/policy`, {
      method: 'PUT',
      body: {
        perTransactionLimitCents: optionalCentsFromUsd(perTransactionLimitUsd),
        dailyCapCents: optionalCentsFromUsd(dailyCapUsd),
        approvalThresholdCents: optionalCentsFromUsd(approvalThresholdUsd),
        allowedMerchants: Array.isArray(allowedMerchants) ? allowedMerchants : undefined
      }
    });

    return response.data;
  }

  async function generateClaimToken({ walletAccountId }) {
    await initialize();
    const response = await send(`/api/users/${walletAccountId}/claim-token`, {
      method: 'POST'
    });

    return response.data;
  }

  async function installWalletDaemon({ label }) {
    const walletInstallationId = createId('wallet_install');
    const installation = {
      walletInstallationId,
      label: label?.trim() || 'CLI daemon',
      createdAt: nowIsoTimestamp(),
      ...generateEd25519Keypair()
    };
    const filePath = await walletStore.saveWalletInstallation(installation);

    return {
      walletInstallationId,
      label: installation.label,
      filePath
    };
  }

  async function claimWalletDaemon({
    walletInstallationId,
    walletAccountId,
    claimToken,
    label
  }) {
    await initialize();
    const { installation } = await walletStore.loadWalletInstallation(walletInstallationId);

    return walletClient.claimInstallation({
      installation,
      walletAccountId,
      claimToken,
      label
    });
  }

  async function listPendingWalletRequests({ walletInstallationId }) {
    await initialize();
    const { installation } = await walletStore.loadWalletInstallation(walletInstallationId);
    const result = await walletClient.pollRequests({ installation });

    return {
      walletInstallationId: result.walletInstallationId,
      requestCount: result.requests.length,
      requests: result.requests
    };
  }

  async function reviewWalletRequest({
    walletInstallationId,
    walletAccountId,
    relayRequestId,
    decision,
    reasonCode
  }) {
    await initialize();
    const { installation } = await walletStore.loadWalletInstallation(walletInstallationId);
    const poll = await walletClient.pollRequests({ installation });
    const relayRequest = poll.requests.find((request) => request.requestId === relayRequestId);

    if (!relayRequest) {
      throw new Error(`Relay request ${relayRequestId} was not found in the pending queue.`);
    }

    return walletClient.authorizeRequest({
      installation,
      relayRequest,
      walletAccountId,
      status: decision === 'reject' ? 'rejected' : 'approved',
      reasonCode: reasonCode?.trim() || (decision === 'reject' ? 'rejected_by_wallet' : 'policy_passed')
    });
  }

  return {
    initialize,
    app,
    createWallet,
    getWallet,
    fundWallet,
    setWalletPolicy,
    generateClaimToken,
    installWalletDaemon,
    claimWalletDaemon,
    listPendingWalletRequests,
    reviewWalletRequest
  };
}
