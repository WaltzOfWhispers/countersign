const storageKey = 'countersign-user-id';

const elements = {
  banner: document.querySelector('#banner'),
  walletId: document.querySelector('#wallet-id'),
  walletSummary: document.querySelector('#wallet-summary'),
  claimTokenCard: document.querySelector('#claim-token-card'),
  agentsList: document.querySelector('#agents-list'),
  approvalsList: document.querySelector('#approvals-list'),
  transactionsList: document.querySelector('#transactions-list'),
  cliGuide: document.querySelector('#cli-guide'),
  createWalletForm: document.querySelector('#create-wallet-form'),
  walletName: document.querySelector('#wallet-name'),
  fundForm: document.querySelector('#fund-form'),
  fundAmount: document.querySelector('#fund-amount'),
  policyForm: document.querySelector('#policy-form'),
  perTransactionLimit: document.querySelector('#per-transaction-limit'),
  dailyCap: document.querySelector('#daily-cap'),
  approvalThreshold: document.querySelector('#approval-threshold'),
  allowedMerchants: document.querySelector('#allowed-merchants'),
  generateClaimToken: document.querySelector('#generate-claim-token'),
  refreshButton: document.querySelector('#refresh-button'),
  forgetButton: document.querySelector('#forget-button')
};

const state = {
  summary: null
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

function renderWalletSummary(summary) {
  if (!summary) {
    elements.walletSummary.classList.add('empty');
    elements.walletSummary.innerHTML =
      'Create a wallet first, then fund it, set a policy, generate a claim token, and connect a local agent installation.';
    elements.walletId.textContent = 'No wallet loaded';
    return;
  }

  elements.walletSummary.classList.remove('empty');
  elements.walletId.textContent = summary.user.id;
  elements.walletSummary.innerHTML = `
    <div class="metric">
      <span class="metric-label">Owner</span>
      <span class="metric-value">${summary.user.name}</span>
    </div>
    <div class="metric">
      <span class="metric-label">Balance</span>
      <span class="metric-value">${formatUsd(summary.wallet.balanceCents)}</span>
    </div>
    <div class="metric">
      <span class="metric-label">Claimed agents</span>
      <span class="metric-value">${summary.agents.length}</span>
    </div>
  `;

  elements.perTransactionLimit.value = (summary.wallet.policy.perTransactionLimitCents / 100).toFixed(2);
  elements.dailyCap.value = (summary.wallet.policy.dailyCapCents / 100).toFixed(2);
  elements.approvalThreshold.value = (summary.wallet.policy.approvalThresholdCents / 100).toFixed(2);
  elements.allowedMerchants.value = summary.wallet.policy.allowedMerchants.join(', ');
}

function renderClaimToken(summary) {
  if (!summary?.activeClaimToken) {
    elements.claimTokenCard.className = 'callout muted';
    elements.claimTokenCard.innerHTML = 'No claim token issued yet.';
    return;
  }

  elements.claimTokenCard.className = 'callout';
  elements.claimTokenCard.innerHTML = `
    <div class="row">
      <strong>Claim token</strong>
      <span class="pill">${new Date(summary.activeClaimToken.expiresAt).toLocaleTimeString()}</span>
    </div>
    <pre class="code">${summary.activeClaimToken.token}</pre>
    <p class="meta">Use this once with the local agent install to bind that keypair to wallet ${summary.user.id}.</p>
  `;
}

function renderAgents(summary) {
  if (!summary?.agents.length) {
    elements.agentsList.className = 'list empty';
    elements.agentsList.textContent = 'No agents claimed yet.';
    return;
  }

  elements.agentsList.className = 'list';
  elements.agentsList.innerHTML = summary.agents
    .map(
      (agent) => `
        <article class="list-card">
          <div class="row">
            <strong>${agent.label}</strong>
            <span class="pill subtle">${agent.id}</span>
          </div>
          <p class="meta">Claimed ${new Date(agent.claimedAt).toLocaleString()}</p>
        </article>
      `
    )
    .join('');
}

function renderApprovals(summary) {
  if (!summary?.pendingApprovals.length) {
    elements.approvalsList.className = 'list empty';
    elements.approvalsList.textContent = 'No approval requests waiting.';
    return;
  }

  elements.approvalsList.className = 'list';
  elements.approvalsList.innerHTML = summary.pendingApprovals
    .map(
      (payment) => `
        <article class="list-card">
          <div class="row">
            <div>
              <strong>${payment.merchant}</strong>
              <p class="meta">${payment.label}</p>
            </div>
            <span class="amount">${formatUsd(payment.amountCents)}</span>
          </div>
          <p class="meta">Reason: ${payment.reason}</p>
          <div class="row">
            <button class="button small" data-action="approve" data-id="${payment.id}" type="button">Approve</button>
            <button class="button small secondary" data-action="reject" data-id="${payment.id}" type="button">Reject</button>
          </div>
        </article>
      `
    )
    .join('');
}

function renderTransactions(summary) {
  if (!summary?.transactions.length) {
    elements.transactionsList.className = 'list empty';
    elements.transactionsList.textContent = 'No transactions yet.';
    return;
  }

  elements.transactionsList.className = 'list';
  elements.transactionsList.innerHTML = summary.transactions
    .map(
      (payment) => `
        <article class="list-card">
          <div class="row">
            <div>
              <div class="row">
                <strong>${payment.merchant}</strong>
                <span class="status ${payment.status}">${payment.status.replace('_', ' ')}</span>
              </div>
              <p class="meta">${payment.agentId} · ${new Date(payment.createdAt).toLocaleString()}</p>
            </div>
            <span class="amount">${formatUsd(payment.amountCents)}</span>
          </div>
          <p class="meta">Reason: ${payment.reason}</p>
          ${
            payment.execution?.providerReference
              ? `<p class="meta">Mock rail ref: ${payment.execution.providerReference}</p>`
              : ''
          }
        </article>
      `
    )
    .join('');
}

function renderGuide(summary) {
  const token = summary?.activeClaimToken?.token || '<claim-token>';
  const walletId = summary?.user?.id || '<wallet-id>';

  elements.cliGuide.innerHTML = `
    <article class="guide-card">
      <strong>1. Install a local agent identity</strong>
      <p class="guide-step">This generates the agent keypair on disk and keeps the private key local.</p>
      <pre class="code">npm run agent:install -- --label "Travel agent"</pre>
    </article>
    <article class="guide-card">
      <strong>2. Claim it to wallet ${walletId}</strong>
      <p class="guide-step">The claim token ties the browser session to a signed claim from the local keypair.</p>
      <pre class="code">npm run agent:claim -- --agent &lt;agent-id&gt; --wallet-account-id ${walletId} --claim-token ${token}</pre>
    </article>
    <article class="guide-card">
      <strong>3. Request a payment</strong>
      <p class="guide-step">The wallet verifies the signature, checks policy, and signs its response back.</p>
      <pre class="code">npm run agent:pay -- --agent &lt;agent-id&gt; --wallet-account-id ${walletId} --merchant travel-api --merchant-domain api.travel.example --amount 24.50 --memo "Hotel hold"</pre>
    </article>
  `;
}

function render() {
  renderWalletSummary(state.summary);
  renderClaimToken(state.summary);
  renderAgents(state.summary);
  renderApprovals(state.summary);
  renderTransactions(state.summary);
  renderGuide(state.summary);
}

async function refreshSummary() {
  const userId = currentUserId();
  if (!userId) {
    state.summary = null;
    render();
    return;
  }

  state.summary = await requestJson(`/api/users/${userId}`);
  render();
}

elements.createWalletForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const summary = await requestJson('/api/users', {
      method: 'POST',
      body: { name: elements.walletName.value }
    });
    setCurrentUserId(summary.user.id);
    state.summary = summary;
    render();
    setBanner(`Created wallet ${summary.user.id}.`);
  } catch (error) {
    setBanner(error.message, 'error');
  }
});

elements.fundForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentUserId()) {
    setBanner('Create a wallet before funding it.', 'error');
    return;
  }

  try {
    const summary = await requestJson(`/api/users/${currentUserId()}/fund`, {
      method: 'POST',
      body: { amountCents: dollarsToCents(elements.fundAmount.value) }
    });
    state.summary = summary;
    render();
    elements.fundAmount.value = '';
    setBanner('Wallet funded through the mock Stripe adapter.');
  } catch (error) {
    setBanner(error.message, 'error');
  }
});

elements.policyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentUserId()) {
    setBanner('Create a wallet before editing policy.', 'error');
    return;
  }

  try {
    const summary = await requestJson(`/api/users/${currentUserId()}/policy`, {
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
    state.summary = summary;
    render();
    setBanner('Policy saved.');
  } catch (error) {
    setBanner(error.message, 'error');
  }
});

elements.generateClaimToken.addEventListener('click', async () => {
  if (!currentUserId()) {
    setBanner('Create a wallet before generating a claim token.', 'error');
    return;
  }

  try {
    const summary = await requestJson(`/api/users/${currentUserId()}/claim-token`, {
      method: 'POST'
    });
    state.summary = summary;
    render();
    setBanner('Claim token issued. Use it once with the local agent install.');
  } catch (error) {
    setBanner(error.message, 'error');
  }
});

elements.approvalsList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  try {
    const result = await requestJson(`/api/approvals/${button.dataset.id}/${button.dataset.action}`, {
      method: 'POST'
    });
    state.summary = result.summary;
    render();
    setBanner(`Approval ${button.dataset.action}d.`);
  } catch (error) {
    setBanner(error.message, 'error');
  }
});

elements.refreshButton.addEventListener('click', async () => {
  try {
    await refreshSummary();
    setBanner('Wallet reloaded.');
  } catch (error) {
    setBanner(error.message, 'error');
  }
});

elements.forgetButton.addEventListener('click', () => {
  setCurrentUserId(null);
  state.summary = null;
  render();
  setBanner('Forgot the local wallet selection.');
});

await refreshSummary();
