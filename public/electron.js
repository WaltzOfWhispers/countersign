const storageKey = 'countersign-user-id';

const elements = {
  banner: document.querySelector('#banner'),
  walletId: document.querySelector('#wallet-id'),
  walletSummary: document.querySelector('#wallet-summary'),
  existingWalletSelect: document.querySelector('#existing-wallet-select'),
  forgetButton: document.querySelector('#forget-button'),
  approvalsList: document.querySelector('#approvals-list'),
  transactionsList: document.querySelector('#transactions-list'),
  policySnapshot: document.querySelector('#policy-snapshot'),
  policyForm: document.querySelector('#policy-form'),
  perTransactionLimit: document.querySelector('#per-transaction-limit'),
  dailyCap: document.querySelector('#daily-cap'),
  approvalThreshold: document.querySelector('#approval-threshold'),
  allowedMerchants: document.querySelector('#allowed-merchants'),
  createWalletForm: document.querySelector('#create-wallet-form'),
  walletName: document.querySelector('#wallet-name'),
  fundForm: document.querySelector('#fund-form'),
  fundAmount: document.querySelector('#fund-amount'),
  fundingPaymentMethodSummary: document.querySelector('#funding-payment-method-summary'),
  createStripeSetupButton: document.querySelector('#create-stripe-setup-button'),
  stripePaymentForm: document.querySelector('#stripe-payment-form'),
  stripePaymentElement: document.querySelector('#stripe-payment-element'),
  walletInstallationsList: document.querySelector('#wallet-installations-list'),
  tabButtons: Array.from(document.querySelectorAll('.tab-button')),
  tabPanels: Array.from(document.querySelectorAll('.tab-panel'))
};

const state = {
  walletCatalog: [],
  summary: null,
  localWalletInstallations: [],
  autoRefreshTimer: null,
  stripeSetup: null
};

function currentUserId() {
  return localStorage.getItem(storageKey);
}

function setCurrentUserId(userId) {
  if (!userId) {
    localStorage.removeItem(storageKey);
    return;
  }

  localStorage.setItem(storageKey, userId);
}

function formatUsd(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format((cents || 0) / 100);
}

function dollarsToCents(value) {
  return Math.round(Number(value) * 100);
}

function claimedRuntime() {
  return (
    state.localWalletInstallations.find((installation) => installation.claimStatus === 'claimed') || null
  );
}

async function requestJson(url, { method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

function setBanner(message, mode = 'info') {
  if (!message) {
    elements.banner.hidden = true;
    elements.banner.textContent = '';
    return;
  }

  elements.banner.hidden = false;
  elements.banner.textContent = message;
  elements.banner.style.color = mode === 'error' ? '#8f2323' : '#1b252a';
}

function renderWalletCatalog() {
  if (!state.walletCatalog.length) {
    elements.existingWalletSelect.innerHTML =
      '<option value="">No wallet discovered yet</option>';
    return;
  }

  const activeWalletId = currentUserId();
  const selectedWalletId = state.walletCatalog.some((wallet) => wallet.id === activeWalletId)
    ? activeWalletId
    : '';

  elements.existingWalletSelect.innerHTML = [
    '<option value="">Select a wallet from the local store</option>',
    ...state.walletCatalog.map(
      (wallet) =>
        `<option value="${wallet.id}">${wallet.name} · ${wallet.id} · ${formatUsd(wallet.balanceCents)}</option>`
    )
  ].join('');
  elements.existingWalletSelect.value = selectedWalletId;
}

function renderWalletSummary() {
  if (!state.summary) {
    elements.walletSummary.classList.add('empty');
    elements.walletSummary.innerHTML =
      'Load a wallet to manage requests, controls, transactions, and settings.';
    elements.walletId.textContent = 'No wallet loaded';
    return;
  }

  const { summary } = state;
  elements.walletSummary.classList.remove('empty');
  elements.walletId.textContent = summary.user.id;
  elements.walletSummary.innerHTML = `
    <div class="metric">
      <span class="metric-label">Owner</span>
      <span class="metric-value">${summary.user.name}</span>
    </div>
    <div class="metric">
      <span class="metric-label">Stored balance</span>
      <span class="metric-value">${formatUsd(summary.wallet.balanceCents)}</span>
    </div>
    <div class="metric">
      <span class="metric-label">Claimed runtimes</span>
      <span class="metric-value">${summary.walletInstallations.length}</span>
    </div>
  `;
}

function renderPolicy() {
  if (!state.summary) {
    elements.policySnapshot.className = 'callout muted';
    elements.policySnapshot.innerHTML = 'Load a wallet to see the active spending policy.';
    elements.perTransactionLimit.value = '';
    elements.dailyCap.value = '';
    elements.approvalThreshold.value = '';
    elements.allowedMerchants.value = '';
    return;
  }

  const policy = state.summary.wallet.policy;
  const allowedMerchants = policy.allowedMerchants.length
    ? policy.allowedMerchants.join(', ')
    : 'Any merchant allowed';

  elements.policySnapshot.className = 'callout';
  elements.policySnapshot.innerHTML = `
    <div class="row">
      <strong>Active policy</strong>
      <span class="pill subtle">Wallet-enforced</span>
    </div>
    <div class="policy-snapshot-grid">
      <div class="metric compact">
        <span class="metric-label">Per transaction</span>
        <span class="metric-value">${formatUsd(policy.perTransactionLimitCents)}</span>
      </div>
      <div class="metric compact">
        <span class="metric-label">Daily cap</span>
        <span class="metric-value">${formatUsd(policy.dailyCapCents)}</span>
      </div>
      <div class="metric compact">
        <span class="metric-label">Approval threshold</span>
        <span class="metric-value">${formatUsd(policy.approvalThresholdCents)}</span>
      </div>
      <div class="metric compact">
        <span class="metric-label">Allowlist</span>
        <span class="metric-value metric-wrap">${allowedMerchants}</span>
      </div>
    </div>
  `;

  elements.perTransactionLimit.value = (policy.perTransactionLimitCents / 100).toFixed(2);
  elements.dailyCap.value = (policy.dailyCapCents / 100).toFixed(2);
  elements.approvalThreshold.value = (policy.approvalThresholdCents / 100).toFixed(2);
  elements.allowedMerchants.value = policy.allowedMerchants.join(', ');
}

function renderTransactions() {
  if (!state.summary?.transactions.length) {
    elements.transactionsList.className = 'list empty';
    elements.transactionsList.textContent = 'No transactions yet.';
    return;
  }

  elements.transactionsList.className = 'list';
  elements.transactionsList.innerHTML = state.summary.transactions
    .map(
      (payment) => `
        <article class="list-card">
          <div class="row">
            <div>
              <div class="row">
                <strong>${payment.merchant}</strong>
                <span class="status ${payment.status}">${payment.status.replaceAll('_', ' ')}</span>
              </div>
              <p class="meta">${payment.agentId} · ${new Date(payment.createdAt).toLocaleString()}</p>
            </div>
            <span class="amount">${formatUsd(payment.amountCents)}</span>
          </div>
          <p class="meta">Reason: ${payment.reason}</p>
          ${payment.execution?.providerReference ? `<p class="meta">Charge ref: ${payment.execution.providerReference}</p>` : ''}
        </article>
      `
    )
    .join('');
}

function renderRuntime() {
  const runtime = claimedRuntime();

  if (!runtime) {
    elements.walletInstallationsList.className = 'list empty';
    elements.walletInstallationsList.textContent = 'No local runtime claimed yet.';
    return;
  }

  elements.walletInstallationsList.className = 'list';
  elements.walletInstallationsList.innerHTML = `
    <article class="list-card">
      <div class="row">
        <div>
          <strong>${runtime.label}</strong>
          <p class="meta">${runtime.walletInstallationId}</p>
        </div>
        <span class="pill">${runtime.claimStatus}</span>
      </div>
      <p class="meta">${
        runtime.paymentMethod
          ? `${runtime.paymentMethod.cardBrand.toUpperCase()} •••• ${runtime.paymentMethod.cardLast4} expires ${String(runtime.paymentMethod.expMonth).padStart(2, '0')}/${runtime.paymentMethod.expYear}`
          : 'No payment method linked yet.'
      }</p>
      <p class="meta">${runtime.pendingRequests.length} pending request(s)</p>
    </article>
  `;
}

function renderFundingPaymentMethod() {
  const runtime = claimedRuntime();
  const paymentMethod = runtime?.paymentMethod || null;

  if (!paymentMethod) {
    elements.fundingPaymentMethodSummary.className = 'callout muted';
    elements.fundingPaymentMethodSummary.textContent = 'No Stripe payment method linked yet.';
    return;
  }

  elements.fundingPaymentMethodSummary.className = 'callout';
  elements.fundingPaymentMethodSummary.innerHTML = `
    <div class="row">
      <strong>Linked payment method</strong>
      <span class="pill subtle">${paymentMethod.provider.replaceAll('_', ' ')}</span>
    </div>
    <p class="meta">${paymentMethod.cardBrand.toUpperCase()} •••• ${paymentMethod.cardLast4} expires ${String(paymentMethod.expMonth).padStart(2, '0')}/${paymentMethod.expYear}</p>
  `;
}

function renderApprovals() {
  const pendingRequests = state.localWalletInstallations.flatMap((installation) =>
    installation.pendingRequests.map((request) => ({
      walletInstallationId: installation.walletInstallationId,
      walletLabel: installation.label,
      request
    }))
  );

  if (!pendingRequests.length) {
    elements.approvalsList.className = 'list empty';
    elements.approvalsList.textContent = 'No relay requests waiting.';
    return;
  }

  elements.approvalsList.className = 'list';
  elements.approvalsList.innerHTML = pendingRequests
    .map(
      ({ walletInstallationId, walletLabel, request }) => `
        <article class="list-card">
          <div class="row">
            <div>
              <strong>${request.payload.agentId}</strong>
              <p class="meta">${request.payload.memo || request.payload.bookingReference || request.requestId}</p>
            </div>
            <span class="amount">${formatUsd(request.payload.amount.minor)}</span>
          </div>
          <p class="meta">Local runtime: ${walletLabel}</p>
          <p class="meta">Booking reference: ${request.payload.bookingReference || 'n/a'}</p>
          <div class="row">
            <button class="button small" data-action="approve" data-installation="${walletInstallationId}" data-id="${request.requestId}" type="button">Approve + Run Charge</button>
            <button class="button small secondary" data-action="reject" data-installation="${walletInstallationId}" data-id="${request.requestId}" type="button">Reject</button>
          </div>
        </article>
      `
    )
    .join('');
}

function render() {
  renderWalletCatalog();
  renderWalletSummary();
  renderPolicy();
  renderTransactions();
  renderRuntime();
  renderFundingPaymentMethod();
  renderApprovals();
}

async function loadWalletCatalog() {
  const result = await requestJson('/api/users');
  state.walletCatalog = result.wallets;
}

async function ensureRuntimeIfNeeded(userId) {
  if (!userId) {
    return;
  }

  const dashboard = await requestJson(`/api/users/${userId}/local-dashboard`);
  const hasClaimedRuntime = dashboard.localWalletInstallations.some(
    (installation) => installation.claimStatus === 'claimed'
  );

  if (hasClaimedRuntime) {
    state.summary = dashboard.summary;
    state.localWalletInstallations = dashboard.localWalletInstallations;
    return;
  }

  const result = await requestJson(`/api/users/${userId}/local-runtime`, {
    method: 'POST',
    body: {
      label: 'Countersign Desktop'
    }
  });

  state.summary = result.dashboard.summary;
  state.localWalletInstallations = result.dashboard.localWalletInstallations;
}

async function loadState() {
  await loadWalletCatalog();

  let userId = currentUserId();
  if (!userId && state.walletCatalog.length === 1) {
    userId = state.walletCatalog[0].id;
    setCurrentUserId(userId);
  }

  if (!userId) {
    state.summary = null;
    state.localWalletInstallations = [];
    render();
    return;
  }

  try {
    await ensureRuntimeIfNeeded(userId);
    render();
  } catch (error) {
    if (error.message === 'User not found.') {
      setCurrentUserId(null);
      state.summary = null;
      state.localWalletInstallations = [];
      render();
      setBanner('Saved wallet selection was not found. Choose a wallet from the local store.', 'error');
      return;
    }

    throw error;
  }
}

async function loadSelectedWallet(userId) {
  if (!userId) {
    setCurrentUserId(null);
    state.summary = null;
    state.localWalletInstallations = [];
    render();
    return;
  }

  setCurrentUserId(userId);
  await loadState();
}

function resetStripeSetup() {
  if (state.stripeSetup?.paymentElement?.unmount) {
    state.stripeSetup.paymentElement.unmount();
  }

  state.stripeSetup = null;
  elements.stripePaymentElement.replaceChildren();
  elements.stripePaymentForm.hidden = true;
}

function activateTab(tabName) {
  elements.tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === tabName;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });

  elements.tabPanels.forEach((panel) => {
    const isActive = panel.id === `${tabName}-panel`;
    panel.classList.toggle('active', isActive);
    panel.hidden = !isActive;
  });
}

elements.tabButtons.forEach((button) => {
  button.addEventListener('click', () => activateTab(button.dataset.tab));
});

elements.existingWalletSelect.addEventListener('change', async () => {
  try {
    await loadSelectedWallet(elements.existingWalletSelect.value);
    if (elements.existingWalletSelect.value) {
      resetStripeSetup();
      setBanner(`Loaded wallet ${elements.existingWalletSelect.value}.`);
    } else {
      resetStripeSetup();
      setBanner('Cleared the wallet selection.');
    }
  } catch (error) {
    setBanner(error.message, 'error');
  }
});

elements.policyForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!currentUserId()) {
    setBanner('Load a wallet before updating policy.', 'error');
    return;
  }

  try {
    await requestJson(`/api/users/${currentUserId()}/policy`, {
      method: 'PUT',
      body: {
        perTransactionLimitCents: dollarsToCents(elements.perTransactionLimit.value),
        dailyCapCents: dollarsToCents(elements.dailyCap.value),
        approvalThresholdCents: dollarsToCents(elements.approvalThreshold.value),
        allowedMerchants: elements.allowedMerchants.value
          .split(',')
          .map((merchant) => merchant.trim())
          .filter(Boolean)
      }
    });
    await loadState();
    activateTab('controls');
    setBanner('Policy updated.');
  } catch (error) {
    setBanner(error.message, 'error');
  }
});

elements.approvalsList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  if (!currentUserId()) {
    setBanner('Load a wallet before reviewing relay requests.', 'error');
    return;
  }

  try {
    await requestJson(
      `/api/users/${currentUserId()}/local-wallet-installations/${button.dataset.installation}/requests/${button.dataset.id}/review`,
      {
        method: 'POST',
        body: {
          decision: button.dataset.action
        }
      }
    );
    await loadState();
    activateTab('requests');
    setBanner(
      button.dataset.action === 'approve'
        ? 'Request approved and local charge executed.'
        : 'Request rejected.'
    );
  } catch (error) {
    setBanner(error.message, 'error');
  }
});

elements.createWalletForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const summary = await requestJson('/api/users', {
      method: 'POST',
      body: { name: elements.walletName.value }
    });
    setCurrentUserId(summary.user.id);
    elements.walletName.value = '';
    await loadState();
    activateTab('settings');
    setBanner(`Created wallet ${summary.user.id} and started the local runtime.`);
  } catch (error) {
    setBanner(error.message, 'error');
  }
});

elements.fundForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!currentUserId()) {
    setBanner('Load a wallet before funding it.', 'error');
    return;
  }

  try {
    await requestJson(`/api/users/${currentUserId()}/fund`, {
      method: 'POST',
      body: { amountCents: dollarsToCents(elements.fundAmount.value) }
    });
    elements.fundAmount.value = '';
    await loadState();
    activateTab('funding');
    setBanner('Stored balance increased.');
  } catch (error) {
    setBanner(error.message, 'error');
  }
});

elements.createStripeSetupButton.addEventListener('click', async () => {
  if (!currentUserId()) {
    setBanner('Load a wallet before linking a Stripe payment method.', 'error');
    return;
  }

  const runtime = claimedRuntime();
  if (!runtime) {
    setBanner('The local agent wallet runtime is still starting. Try again in a moment.', 'error');
    return;
  }

  if (typeof window.Stripe !== 'function') {
    setBanner('Stripe.js did not load in the desktop app.', 'error');
    return;
  }

  try {
    resetStripeSetup();
    const setupIntent = await requestJson(
      `/api/users/${currentUserId()}/local-wallet-installations/${runtime.walletInstallationId}/stripe/setup-intent`,
      {
        method: 'POST'
      }
    );

    const stripe = window.Stripe(setupIntent.publishableKey);
    const elementsApi = stripe.elements({
      clientSecret: setupIntent.clientSecret
    });
    const paymentElement = elementsApi.create('payment');
    paymentElement.mount('#stripe-payment-element');

    state.stripeSetup = {
      stripe,
      elements: elementsApi,
      paymentElement,
      setupIntentId: setupIntent.setupIntentId
    };

    elements.stripePaymentForm.hidden = false;
    activateTab('funding');
    setBanner('Stripe card setup started. Enter card details and save the card.');
  } catch (error) {
    setBanner(error.message, 'error');
  }
});

elements.stripePaymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!currentUserId()) {
    setBanner('Load a wallet before linking a Stripe payment method.', 'error');
    return;
  }

  const runtime = claimedRuntime();
  if (!runtime) {
    setBanner('The local agent wallet runtime is still starting. Try again in a moment.', 'error');
    return;
  }

  if (!state.stripeSetup) {
    setBanner('Start Stripe card setup first.', 'error');
    return;
  }

  try {
    const { error, setupIntent } = await state.stripeSetup.stripe.confirmSetup({
      elements: state.stripeSetup.elements,
      redirect: 'if_required'
    });

    if (error) {
      throw error;
    }

    await requestJson(
      `/api/users/${currentUserId()}/local-wallet-installations/${runtime.walletInstallationId}/payment-method/stripe`,
      {
        method: 'POST',
        body: {
          setupIntentId: setupIntent?.id || state.stripeSetup.setupIntentId
        }
      }
    );

    resetStripeSetup();
    await loadState();
    activateTab('funding');
    setBanner(`Linked Stripe payment method to ${runtime.walletInstallationId}.`);
  } catch (error) {
    setBanner(error.message, 'error');
  }
});

elements.forgetButton.addEventListener('click', () => {
  setCurrentUserId(null);
  state.summary = null;
  state.localWalletInstallations = [];
  resetStripeSetup();
  render();
  setBanner('Forgot the local wallet selection.');
});

function startAutoRefresh() {
  if (state.autoRefreshTimer) {
    clearInterval(state.autoRefreshTimer);
  }

  state.autoRefreshTimer = setInterval(async () => {
    try {
      await loadState();
    } catch {
      // keep the desktop UI stable; manual refresh can surface errors
    }
  }, 5000);
}

activateTab('home');
await loadState();
startAutoRefresh();
