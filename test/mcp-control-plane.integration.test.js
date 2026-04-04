import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCountersignControlPlane } from '../src/mcp/control-plane.js';

function createFakeStripeGateway() {
  const calls = [];

  return {
    enabled: true,
    serverEnabled: true,
    publishableKey: 'pk_test_countersign',
    calls,
    async ensureCustomer({ existingCustomerId, walletAccountId }) {
      calls.push({ type: 'ensureCustomer', existingCustomerId, walletAccountId });
      return existingCustomerId || `cus_${walletAccountId}`;
    },
    async createHostedSetupSession({ customerId, walletAccountId, walletInstallationId }) {
      calls.push({
        type: 'createHostedSetupSession',
        customerId,
        walletAccountId,
        walletInstallationId
      });
      return {
        id: `cs_${walletInstallationId}`,
        url: `https://checkout.stripe.test/${walletInstallationId}`,
        customerId
      };
    },
    async getPaymentMethodForSetupSession({ checkoutSessionId }) {
      calls.push({ type: 'getPaymentMethodForSetupSession', checkoutSessionId });
      return {
        provider: 'stripe_payment_method',
        customerId: 'cus_wallet_stripe_1',
        paymentMethodId: 'pm_wallet_stripe_1',
        setupIntentId: `seti_from_${checkoutSessionId}`,
        cardBrand: 'visa',
        cardLast4: '4242',
        expMonth: 12,
        expYear: 2030
      };
    },
    async createWalletCharge() {
      throw new Error('not used in this test');
    }
  };
}

test('MCP control plane can start and complete a real Stripe payment-method setup flow', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-mcp-control-plane-test-'));
  const stripeGateway = createFakeStripeGateway();
  const controlPlane = createCountersignControlPlane({
    dataFile: join(rootDir, 'data', 'store.json'),
    walletDir: join(rootDir, 'local-wallet'),
    stripeGateway
  });

  const created = await controlPlane.createWallet({ name: 'CLI Stripe Wallet' });
  const walletAccountId = created.user.id;

  const claimTokenResponse = await controlPlane.generateClaimToken({ walletAccountId });
  const claimToken = claimTokenResponse.activeClaimToken.token;

  const installation = await controlPlane.installWalletDaemon({ label: 'CLI wallet' });
  const walletInstallationId = installation.walletInstallationId;

  await controlPlane.claimWalletDaemon({
    walletInstallationId,
    walletAccountId,
    claimToken
  });

  const started = await controlPlane.linkWalletPaymentMethod({
    walletInstallationId,
    walletAccountId
  });

  assert.equal(started.nextAction, 'complete_stripe_checkout');
  assert.equal(started.checkoutSessionId, `cs_${walletInstallationId}`);
  assert.equal(started.checkoutUrl, `https://checkout.stripe.test/${walletInstallationId}`);

  const completed = await controlPlane.linkWalletPaymentMethod({
    walletInstallationId,
    walletAccountId,
    checkoutSessionId: started.checkoutSessionId
  });

  assert.equal(completed.nextAction, 'completed');
  assert.equal(completed.walletInstallation.paymentMethod.provider, 'stripe_payment_method');
  assert.equal(completed.walletInstallation.paymentMethod.paymentMethodId, 'pm_wallet_stripe_1');
});
