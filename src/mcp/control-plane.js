import { join } from 'node:path';

import { createAgentWalletApp } from '../app.js';
import { createLocalWalletControlPlane } from '../lib/local-control-plane.js';
import { runMockStripeWalletCharge } from '../lib/payment-rails.js';
import { createStripeGateway } from '../lib/stripe-gateway.js';

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
  trustedAgents = {},
  stripeGateway = createStripeGateway()
} = {}) {
  const app = createAgentWalletApp({
    dataFile,
    walletDir,
    trustedAgents,
    stripeGateway
  });
  const send = createAppTransport(app);
  const localControlPlane = createLocalWalletControlPlane({
    send,
    walletDir,
    executeCharge: async ({ installation, walletAccountId, relayRequest }) => {
      if (!installation.paymentMethod) {
        return undefined;
      }

      if (installation.paymentMethod.provider === 'stripe_payment_method' && stripeGateway.enabled) {
        return stripeGateway.createWalletCharge({
          customerId: installation.paymentMethod.customerId,
          paymentMethodId: installation.paymentMethod.paymentMethodId,
          amountCents: Math.round(Number(relayRequest.payload.amount?.minor)),
          currency: relayRequest.payload.amount?.currency || 'USD',
          walletAccountId,
          agentId: relayRequest.payload.agentId,
          relayRequestId: relayRequest.requestId
        });
      }

      if (installation.paymentMethod.provider === 'mock_stripe_payment_method') {
        return runMockStripeWalletCharge({
          amountCents: Math.round(Number(relayRequest.payload.amount?.minor)),
          currency: relayRequest.payload.amount?.currency || 'USD',
          walletAccountId,
          agentId: relayRequest.payload.agentId,
          relayRequestId: relayRequest.requestId,
          paymentMethod: installation.paymentMethod
        });
      }

      return undefined;
    }
  });

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

  async function listWallets() {
    await initialize();
    const response = await send('/api/users');
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
    const result = await localControlPlane.installWalletDaemon({ label });
    return {
      walletInstallationId: result.walletInstallationId,
      label: result.label,
      filePath: result.filePath
    };
  }

  async function claimWalletDaemon({
    walletInstallationId,
    walletAccountId,
    claimToken,
    label
  }) {
    await initialize();
    return localControlPlane.claimWalletDaemon({
      walletInstallationId,
      walletAccountId,
      claimToken,
      label
    });
  }

  async function linkWalletPaymentMethod({
    walletInstallationId,
    walletAccountId,
    checkoutSessionId,
    returnUrl,
    cancelUrl
  }) {
    await initialize();

    if (!stripeGateway.serverEnabled) {
      throw new Error('Stripe is not configured on this Countersign server.');
    }

    if (!walletAccountId) {
      throw new Error('walletAccountId is required to link a real Stripe payment method.');
    }

    if (!checkoutSessionId) {
      const response = await send(
        `/api/users/${walletAccountId}/local-wallet-installations/${walletInstallationId}/stripe/setup-session`,
        {
          method: 'POST',
          body: {
            returnUrl,
            cancelUrl
          }
        }
      );

      if (response.status >= 400) {
        throw new Error(response.data?.error || 'Failed to start Stripe setup session.');
      }

      return {
        walletInstallationId,
        walletAccountId,
        nextAction: 'complete_stripe_checkout',
        ...response.data
      };
    }

    const response = await send(
      `/api/users/${walletAccountId}/local-wallet-installations/${walletInstallationId}/payment-method/stripe-session`,
      {
        method: 'POST',
        body: {
          checkoutSessionId
        }
      }
    );

    if (response.status >= 400) {
      throw new Error(response.data?.error || 'Failed to sync Stripe payment method.');
    }

    return {
      walletInstallationId,
      walletAccountId,
      nextAction: 'completed',
      ...response.data
    };
  }

  async function listPendingWalletRequests({ walletInstallationId }) {
    await initialize();
    return localControlPlane.listPendingWalletRequests({ walletInstallationId });
  }

  async function reviewWalletRequest({
    walletInstallationId,
    walletAccountId,
    relayRequestId,
    decision,
    reasonCode
  }) {
    await initialize();
    return localControlPlane.reviewWalletRequest({
      walletInstallationId,
      walletAccountId,
      relayRequestId,
      decision,
      reasonCode
    });
  }

  async function listWalletCards({ walletAccountId }) {
    await initialize();
    return localControlPlane.listWalletCards({ walletAccountId });
  }

  async function setDefaultWalletCard({ walletAccountId, paymentMethodId }) {
    await initialize();
    return localControlPlane.setDefaultWalletCard({ walletAccountId, paymentMethodId });
  }

  async function requestWalletCharge({
    walletAccountId,
    merchant,
    amountUsd,
    memo,
    bookingReference,
    paymentMethodId
  }) {
    await initialize();
    const response = await send(`/api/users/${walletAccountId}/charge-requests`, {
      method: 'POST',
      body: {
        merchant,
        amountCents: centsFromUsd(amountUsd, 'amountUsd'),
        memo,
        bookingReference,
        paymentMethodId
      }
    });

    if (response.status >= 400) {
      throw new Error(response.data?.error || 'Failed to request a wallet charge.');
    }

    return response.data;
  }

  async function listWalletRequests({ walletAccountId }) {
    await initialize();
    return localControlPlane.listWalletRequests({ walletAccountId });
  }

  async function respondWalletRequest({
    walletAccountId,
    relayRequestId,
    decision,
    reasonCode,
    paymentMethodId
  }) {
    await initialize();
    return {
      result: await localControlPlane.respondWalletRequest({
        walletAccountId,
        relayRequestId,
        decision,
        reasonCode,
        paymentMethodId
      })
    };
  }

  return {
    initialize,
    app,
    listWallets,
    createWallet,
    getWallet,
    fundWallet,
    setWalletPolicy,
    generateClaimToken,
    installWalletDaemon,
    linkWalletPaymentMethod,
    claimWalletDaemon,
    listPendingWalletRequests,
    reviewWalletRequest,
    listWalletCards,
    setDefaultWalletCard,
    requestWalletCharge,
    listWalletRequests,
    respondWalletRequest
  };
}
