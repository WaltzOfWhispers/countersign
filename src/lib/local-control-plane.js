import { createId, nowIsoTimestamp } from './ids.js';
import { generateEd25519Keypair } from './crypto.js';
import { createMockStripePaymentMethod } from './payment-rails.js';
import { createWalletDaemonClient } from './wallet-daemon-client.js';
import { createWalletInstallationStore } from './wallet-installation-files.js';

function ensureOk(response, fallbackMessage) {
  if (response.status >= 200 && response.status < 300) {
    return response.data;
  }

  throw new Error(response.data?.error || fallbackMessage);
}

export function createLocalWalletControlPlane({ send, walletDir, executeCharge }) {
  const walletClient = createWalletDaemonClient({ send, executeCharge });
  const walletStore = createWalletInstallationStore({ walletDir });

  async function call(pathname, options) {
    return send(pathname, options);
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
      filePath,
      installation
    };
  }

  async function linkWalletPaymentMethod({
    walletInstallationId,
    paymentMethod,
    cardBrand = 'visa',
    cardLast4 = '4242',
    expMonth = 12,
    expYear = 2030
  }) {
    const nextPaymentMethod =
      paymentMethod ||
      createMockStripePaymentMethod({
        cardBrand,
        cardLast4,
        expMonth,
        expYear
      });

    const result = await walletStore.updateWalletInstallation(walletInstallationId, (installation) => ({
      ...installation,
      paymentMethods: [
        ...(installation.paymentMethods || []).filter(
          (existingPaymentMethod) =>
            existingPaymentMethod.paymentMethodId !== nextPaymentMethod.paymentMethodId
        ),
        nextPaymentMethod
      ],
      activePaymentMethodId:
        nextPaymentMethod.paymentMethodId ||
        installation.paymentMethod?.paymentMethodId ||
        null
    }));

    return {
      walletInstallationId: result.installation.walletInstallationId,
      paymentMethod: result.installation.paymentMethod,
      installation: result.installation
    };
  }

  async function claimWalletDaemon({
    walletInstallationId,
    walletAccountId,
    claimToken,
    label
  }) {
    const { installation } = await walletStore.loadWalletInstallation(walletInstallationId);

    return walletClient.claimInstallation({
      installation,
      walletAccountId,
      claimToken,
      label
    });
  }

  async function ensureLocalWalletRuntime({
    walletAccountId,
    label = 'Countersign Desktop'
  }) {
    const dashboard = await getLocalDashboard({ walletAccountId });
    const claimedInstallation = dashboard.localWalletInstallations.find(
      (installation) =>
        installation.claimStatus === 'claimed' && installation.ownerUserId === walletAccountId
    );

    if (claimedInstallation) {
      const { installation } = await walletStore.loadWalletInstallation(
        claimedInstallation.walletInstallationId
      );
      return {
        created: false,
        walletInstallation: {
          ...installation,
          ownerUserId: claimedInstallation.ownerUserId,
          claimedAt: claimedInstallation.claimedAt
        },
        dashboard
      };
    }

    const reusableInstallation = dashboard.localWalletInstallations.find(
      (installation) => installation.claimStatus === 'unclaimed'
    );
    const installed =
      reusableInstallation ||
      (await installWalletDaemon({
        label
      })).installation;

    const claimTokenResponse = ensureOk(
      await call(`/api/users/${walletAccountId}/claim-token`, {
        method: 'POST'
      }),
      'Failed to generate local runtime claim token.'
    );

    const claimResult = await claimWalletDaemon({
      walletInstallationId: installed.walletInstallationId,
      walletAccountId,
      claimToken: claimTokenResponse.activeClaimToken.token,
      label
    });

    return {
      created: true,
      walletInstallation: claimResult.walletInstallation,
      dashboard: await getLocalDashboard({ walletAccountId })
    };
  }

  async function listPendingWalletRequests({ walletInstallationId }) {
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
    reasonCode,
    paymentMethodId
  }) {
    const { installation } = await walletStore.loadWalletInstallation(walletInstallationId);
    const poll = await walletClient.pollRequests({ installation });
    const relayRequest = poll.requests.find((request) => request.requestId === relayRequestId);

    if (!relayRequest) {
      throw new Error(`Relay request ${relayRequestId} was not found in the pending queue.`);
    }

    let selectedInstallation = installation;
    if (paymentMethodId) {
      const selectedPaymentMethod = (installation.paymentMethods || []).find(
        (paymentMethod) => paymentMethod.paymentMethodId === paymentMethodId
      );

      if (!selectedPaymentMethod) {
        throw new Error(`Payment method ${paymentMethodId} was not found on this local wallet runtime.`);
      }

      selectedInstallation = {
        ...installation,
        paymentMethod: selectedPaymentMethod
      };
    }

    return walletClient.authorizeRequest({
      installation: selectedInstallation,
      relayRequest,
      walletAccountId,
      status: decision === 'reject' ? 'rejected' : 'approved',
      reasonCode: reasonCode?.trim() || (decision === 'reject' ? 'rejected_by_wallet' : 'policy_passed')
    });
  }

  async function getLocalDashboard({ walletAccountId }) {
    const summary = ensureOk(
      await call(`/api/users/${walletAccountId}`),
      'Failed to load wallet summary.'
    );
    const claimedById = new Map(
      (summary.walletInstallations || []).map((installation) => [installation.id, installation])
    );
    const localInstallations = await walletStore.listWalletInstallations();

    const mergedInstallations = await Promise.all(
      localInstallations.map(async ({ installation }) => {
        const claimedInstallation = claimedById.get(installation.walletInstallationId);
        let pendingRequests = [];

        if (claimedInstallation?.ownerUserId === walletAccountId) {
          const polled = await walletClient.pollRequests({ installation });
          pendingRequests = polled.requests;
        }

        return {
          walletInstallationId: installation.walletInstallationId,
          label: installation.label,
          createdAt: installation.createdAt,
          claimStatus: claimedInstallation ? 'claimed' : 'unclaimed',
          ownerUserId: claimedInstallation?.ownerUserId || null,
          claimedAt: claimedInstallation?.claimedAt || null,
          paymentMethod: installation.paymentMethod || null,
          paymentMethods: installation.paymentMethods || [],
          activePaymentMethodId: installation.activePaymentMethodId || null,
          pendingRequests
        };
      })
    );

    return {
      summary,
      localWalletInstallations: mergedInstallations
    };
  }

  return {
    installWalletDaemon,
    linkWalletPaymentMethod,
    claimWalletDaemon,
    ensureLocalWalletRuntime,
    listPendingWalletRequests,
    reviewWalletRequest,
    getLocalDashboard
  };
}
