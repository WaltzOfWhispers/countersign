import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { createAgentWalletApp } from '../src/app.js';
import { generateEd25519Keypair, signPayload } from '../src/lib/crypto.js';

function createMcpClient({ env }) {
  const child = spawn('node', ['src/mcp/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let nextId = 1;
  let buffer = '';
  const pending = new Map();
  let childExitError = null;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;

    while (buffer.includes('\n')) {
      const newlineIndex = buffer.indexOf('\n');
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      const message = JSON.parse(line);
      const pendingRequest = pending.get(message.id);
      if (pendingRequest) {
        pending.delete(message.id);
        pendingRequest.resolve(message);
      }
    }
  });

  child.once('exit', (code, signal) => {
    childExitError = new Error(`MCP server exited before responding (code=${code}, signal=${signal}).`);
    for (const pendingRequest of pending.values()) {
      pendingRequest.reject(childExitError);
    }
    pending.clear();
  });

  child.stderr.resume();

  function request(method, params) {
    const id = nextId++;
    const message = { jsonrpc: '2.0', id, method, params };
    if (childExitError) {
      return Promise.reject(childExitError);
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  }

  function notify(method, params) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async function close() {
    if (child.killed || child.exitCode !== null) {
      return;
    }

    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }

  return {
    request,
    notify,
    close
  };
}

test('Countersign MCP server initializes and lists wallet tools', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-mcp-test-'));
  const client = createMcpClient({
    env: {
      COUNTERSIGN_DATA_FILE: join(rootDir, 'data', 'store.json'),
      COUNTERSIGN_WALLET_DIR: join(rootDir, 'local-wallet')
    }
  });

  try {
    const initialize = await client.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'mcp-test-client',
        version: '0.0.0'
      }
    });

    assert.equal(initialize.result.serverInfo.name, 'countersign-mcp');
    assert.deepEqual(initialize.result.capabilities, {
      tools: {
        listChanged: false
      }
    });

    client.notify('notifications/initialized');

    const tools = await client.request('tools/list', {});
    const toolNames = tools.result.tools.map((tool) => tool.name);

    assert(toolNames.includes('list_wallets'));
    assert(toolNames.includes('create_wallet'));
    assert(toolNames.includes('get_wallet'));
    assert(toolNames.includes('link_wallet_payment_method'));
    assert(toolNames.includes('list_wallet_cards'));
    assert(toolNames.includes('set_default_wallet_card'));
    assert(toolNames.includes('request_wallet_charge'));
    assert(toolNames.includes('list_wallet_requests'));
    assert(toolNames.includes('respond_wallet_request'));
  } finally {
    await client.close();
  }
});

test('Countersign MCP tools can list wallets from the shared store', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-mcp-list-wallets-test-'));
  const client = createMcpClient({
    env: {
      COUNTERSIGN_DATA_FILE: join(rootDir, 'data', 'store.json'),
      COUNTERSIGN_WALLET_DIR: join(rootDir, 'local-wallet')
    }
  });

  try {
    await client.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'mcp-test-client',
        version: '0.0.0'
      }
    });
    client.notify('notifications/initialized');

    await client.request('tools/call', {
      name: 'create_wallet',
      arguments: {
        name: 'First wallet'
      }
    });

    await client.request('tools/call', {
      name: 'create_wallet',
      arguments: {
        name: 'Second wallet'
      }
    });

    const listed = await client.request('tools/call', {
      name: 'list_wallets',
      arguments: {}
    });

    assert.equal(listed.result.structuredContent.wallets.length, 2);
    assert.deepEqual(
      listed.result.structuredContent.wallets.map((wallet) => wallet.name).sort(),
      ['First wallet', 'Second wallet']
    );
  } finally {
    await client.close();
  }
});

test('Countersign MCP tools can create, install, and claim a local wallet daemon', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-mcp-wallet-test-'));
  const client = createMcpClient({
    env: {
      COUNTERSIGN_DATA_FILE: join(rootDir, 'data', 'store.json'),
      COUNTERSIGN_WALLET_DIR: join(rootDir, 'local-wallet')
    }
  });

  try {
    await client.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'mcp-test-client',
        version: '0.0.0'
      }
    });
    client.notify('notifications/initialized');

    const created = await client.request('tools/call', {
      name: 'create_wallet',
      arguments: {
        name: 'MCP Wallet'
      }
    });
    const walletAccountId = created.result.structuredContent.user.id;

    const claimTokenResponse = await client.request('tools/call', {
      name: 'generate_claim_token',
      arguments: {
        walletAccountId
      }
    });
    const claimToken = claimTokenResponse.result.structuredContent.activeClaimToken.token;

    const installation = await client.request('tools/call', {
      name: 'install_wallet_daemon',
      arguments: {
        label: 'Claude wallet'
      }
    });
    const walletInstallationId = installation.result.structuredContent.walletInstallationId;

    const claimed = await client.request('tools/call', {
      name: 'claim_wallet_daemon',
      arguments: {
        walletInstallationId,
        walletAccountId,
        claimToken
      }
    });

    assert.equal(claimed.result.structuredContent.walletInstallation.ownerUserId, walletAccountId);

    const wallet = await client.request('tools/call', {
      name: 'get_wallet',
      arguments: {
        walletAccountId
      }
    });

    assert.equal(wallet.result.structuredContent.walletInstallations.length, 1);
    assert.equal(wallet.result.structuredContent.walletInstallations[0].id, walletInstallationId);
  } finally {
    await client.close();
  }
});

test('Countersign MCP tools can list pending travel-agent requests and surface approval failures without a linked card', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-mcp-review-test-'));
  const travelAgentKeys = generateEd25519Keypair();
  const trustedAgents = {
    'travel-agent': {
      id: 'travel-agent',
      publicKeyPem: travelAgentKeys.publicKeyPem
    }
  };
  const dataFile = join(rootDir, 'data', 'store.json');
  const walletDir = join(rootDir, 'local-wallet');
  const client = createMcpClient({
    env: {
      COUNTERSIGN_DATA_FILE: dataFile,
      COUNTERSIGN_WALLET_DIR: walletDir,
      COUNTERSIGN_TRUSTED_AGENTS_JSON: JSON.stringify(trustedAgents)
    }
  });

  try {
    await client.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'mcp-test-client',
        version: '0.0.0'
      }
    });
    client.notify('notifications/initialized');

    const created = await client.request('tools/call', {
      name: 'create_wallet',
      arguments: {
        name: 'MCP Review Wallet'
      }
    });
    const walletAccountId = created.result.structuredContent.user.id;

    const claimTokenResponse = await client.request('tools/call', {
      name: 'generate_claim_token',
      arguments: {
        walletAccountId
      }
    });
    const claimToken = claimTokenResponse.result.structuredContent.activeClaimToken.token;

    const installation = await client.request('tools/call', {
      name: 'install_wallet_daemon',
      arguments: {
        label: 'Claude wallet'
      }
    });
    const walletInstallationId = installation.result.structuredContent.walletInstallationId;

    await client.request('tools/call', {
      name: 'claim_wallet_daemon',
      arguments: {
        walletInstallationId,
        walletAccountId,
        claimToken
      }
    });

    const app = createAgentWalletApp({
      dataFile,
      trustedAgents
    });
    await app.ensureWalletIdentity();

    const securityCode = await app.routeRequest({
      method: 'POST',
      pathname: `/api/users/${walletAccountId}/agent-link-code`
    });
    assert.equal(securityCode.statusCode, 201);

    const pairingPayload = {
      type: 'agent.wallet_pairing.v1',
      requestId: 'pair_req_mcp_1',
      agentId: 'travel-agent',
      walletAccountId,
      securityCode: securityCode.payload.activeAgentLinkCode.code,
      timestamp: new Date().toISOString(),
      nonce: 'pair_nonce_mcp_1'
    };

    const pairing = await app.routeRequest({
      method: 'POST',
      pathname: '/api/relay/agent-links',
      body: {
        payload: pairingPayload,
        signature: signPayload(pairingPayload, travelAgentKeys.privateKeyPem)
      }
    });
    assert.equal(pairing.statusCode, 201);

    const relayPayload = {
      type: 'travel.payment_authorization_request.v1',
      requestId: 'travel_req_mcp_1',
      agentId: 'travel-agent',
      walletAccountId,
      amount: {
        currency: 'USD',
        minor: 2450
      },
      bookingReference: 'trip_mcp_1',
      memo: 'Flight booking charge',
      timestamp: new Date().toISOString(),
      nonce: 'travel_nonce_mcp_1'
    };

    await app.routeRequest({
      method: 'POST',
      pathname: '/api/relay/travel-agent/requests',
      body: {
        payload: relayPayload,
        signature: signPayload(relayPayload, travelAgentKeys.privateKeyPem)
      }
    });

    const pending = await client.request('tools/call', {
      name: 'list_pending_wallet_requests',
      arguments: {
        walletInstallationId
      }
    });

    assert.equal(pending.result.structuredContent.requestCount, 1);
    assert.equal(pending.result.structuredContent.requests[0].requestId, relayPayload.requestId);

    const review = await client.request('tools/call', {
      name: 'review_wallet_request',
      arguments: {
        walletInstallationId,
        walletAccountId,
        relayRequestId: relayPayload.requestId,
        decision: 'approve'
      }
    });

    assert.equal(review.result.isError, true);
    assert.match(review.result.content[0].text, /insufficient_funds/);

    const agentView = await app.routeRequest({
      method: 'GET',
      pathname: `/api/relay/travel-agent/requests/${relayPayload.requestId}`
    });

    assert.equal(agentView.statusCode, 200);
    assert.equal(agentView.payload.status, 'pending_wallet');
    assert.equal(agentView.payload.execution, null);
    assert.equal(agentView.payload.receipt, null);
  } finally {
    await client.close();
  }
});

test('Countersign MCP tools can list wallet cards and set the default card', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-mcp-cards-test-'));
  const dataFile = join(rootDir, 'data', 'store.json');
  const walletDir = join(rootDir, 'local-wallet');
  const client = createMcpClient({
    env: {
      COUNTERSIGN_DATA_FILE: dataFile,
      COUNTERSIGN_WALLET_DIR: walletDir
    }
  });

  try {
    await client.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'mcp-test-client',
        version: '0.0.0'
      }
    });
    client.notify('notifications/initialized');

    const created = await client.request('tools/call', {
      name: 'create_wallet',
      arguments: {
        name: 'MCP Card Wallet'
      }
    });
    const walletAccountId = created.result.structuredContent.user.id;

    const claimTokenResponse = await client.request('tools/call', {
      name: 'generate_claim_token',
      arguments: {
        walletAccountId
      }
    });
    const claimToken = claimTokenResponse.result.structuredContent.activeClaimToken.token;

    const installation = await client.request('tools/call', {
      name: 'install_wallet_daemon',
      arguments: {
        label: 'Claude wallet'
      }
    });
    const walletInstallationId = installation.result.structuredContent.walletInstallationId;

    await client.request('tools/call', {
      name: 'claim_wallet_daemon',
      arguments: {
        walletInstallationId,
        walletAccountId,
        claimToken
      }
    });

    const app = createAgentWalletApp({
      dataFile,
      walletDir
    });
    await app.ensureWalletIdentity();

    const firstCard = await app.routeRequest({
      method: 'POST',
      pathname: `/api/users/${walletAccountId}/local-wallet-installations/${walletInstallationId}/payment-method`,
      body: {
        cardBrand: 'visa',
        cardLast4: '4242',
        expMonth: 12,
        expYear: 2030
      }
    });
    assert.equal(firstCard.statusCode, 200);

    const secondCard = await app.routeRequest({
      method: 'POST',
      pathname: `/api/users/${walletAccountId}/local-wallet-installations/${walletInstallationId}/payment-method`,
      body: {
        cardBrand: 'mastercard',
        cardLast4: '5454',
        expMonth: 8,
        expYear: 2031
      }
    });
    assert.equal(secondCard.statusCode, 200);

    const listed = await client.request('tools/call', {
      name: 'list_wallet_cards',
      arguments: {
        walletAccountId
      }
    });

    assert.equal(listed.result.structuredContent.cards.length, 2);
    assert.equal(listed.result.structuredContent.activePaymentMethod.cardLast4, '5454');

    const setDefault = await client.request('tools/call', {
      name: 'set_default_wallet_card',
      arguments: {
        walletAccountId,
        paymentMethodId: listed.result.structuredContent.cards[0].paymentMethodId
      }
    });

    assert.equal(setDefault.result.structuredContent.activePaymentMethod.cardLast4, '4242');
    assert.equal(setDefault.result.structuredContent.cards[0].paymentMethodId, listed.result.structuredContent.cards[0].paymentMethodId);
  } finally {
    await client.close();
  }
});

test('Countersign MCP tools can request a local wallet charge with the default saved card', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-mcp-charge-test-'));
  const dataFile = join(rootDir, 'data', 'store.json');
  const walletDir = join(rootDir, 'local-wallet');
  const client = createMcpClient({
    env: {
      COUNTERSIGN_DATA_FILE: dataFile,
      COUNTERSIGN_WALLET_DIR: walletDir
    }
  });

  try {
    await client.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'mcp-test-client',
        version: '0.0.0'
      }
    });
    client.notify('notifications/initialized');

    const created = await client.request('tools/call', {
      name: 'create_wallet',
      arguments: {
        name: 'MCP Claude Wallet'
      }
    });
    const walletAccountId = created.result.structuredContent.user.id;

    const claimTokenResponse = await client.request('tools/call', {
      name: 'generate_claim_token',
      arguments: {
        walletAccountId
      }
    });
    const claimToken = claimTokenResponse.result.structuredContent.activeClaimToken.token;

    const installation = await client.request('tools/call', {
      name: 'install_wallet_daemon',
      arguments: {
        label: 'Claude wallet'
      }
    });
    const walletInstallationId = installation.result.structuredContent.walletInstallationId;

    await client.request('tools/call', {
      name: 'claim_wallet_daemon',
      arguments: {
        walletInstallationId,
        walletAccountId,
        claimToken
      }
    });

    const app = createAgentWalletApp({
      dataFile,
      walletDir
    });
    await app.ensureWalletIdentity();

    const linked = await app.routeRequest({
      method: 'POST',
      pathname: `/api/users/${walletAccountId}/local-wallet-installations/${walletInstallationId}/payment-method`,
      body: {
        cardBrand: 'visa',
        cardLast4: '4242',
        expMonth: 12,
        expYear: 2030
      }
    });
    assert.equal(linked.statusCode, 200);

    const charged = await client.request('tools/call', {
      name: 'request_wallet_charge',
      arguments: {
        walletAccountId,
        merchant: 'duffel',
        amountUsd: 24.5,
        memo: 'Flight booking charge',
        bookingReference: 'trip_mcp_local_charge_1'
      }
    });

    assert.equal(charged.result.structuredContent.status, 'charged');
    assert.equal(charged.result.structuredContent.execution.provider, 'mock_stripe_wallet_charge');
    assert.equal(charged.result.structuredContent.execution.cardLast4, '4242');
  } finally {
    await client.close();
  }
});

test('Countersign MCP tools can review a pending local wallet charge without exposing runtime ids', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-mcp-local-review-test-'));
  const dataFile = join(rootDir, 'data', 'store.json');
  const walletDir = join(rootDir, 'local-wallet');
  const client = createMcpClient({
    env: {
      COUNTERSIGN_DATA_FILE: dataFile,
      COUNTERSIGN_WALLET_DIR: walletDir
    }
  });

  try {
    await client.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'mcp-test-client',
        version: '0.0.0'
      }
    });
    client.notify('notifications/initialized');

    const created = await client.request('tools/call', {
      name: 'create_wallet',
      arguments: {
        name: 'MCP Review Wallet'
      }
    });
    const walletAccountId = created.result.structuredContent.user.id;

    await client.request('tools/call', {
      name: 'set_wallet_policy',
      arguments: {
        walletAccountId,
        perTransactionLimitUsd: 150,
        dailyCapUsd: 500,
        approvalThresholdUsd: 50
      }
    });

    const claimTokenResponse = await client.request('tools/call', {
      name: 'generate_claim_token',
      arguments: {
        walletAccountId
      }
    });
    const claimToken = claimTokenResponse.result.structuredContent.activeClaimToken.token;

    const installation = await client.request('tools/call', {
      name: 'install_wallet_daemon',
      arguments: {
        label: 'Claude wallet'
      }
    });
    const walletInstallationId = installation.result.structuredContent.walletInstallationId;

    await client.request('tools/call', {
      name: 'claim_wallet_daemon',
      arguments: {
        walletInstallationId,
        walletAccountId,
        claimToken
      }
    });

    const app = createAgentWalletApp({
      dataFile,
      walletDir
    });
    await app.ensureWalletIdentity();

    const linked = await app.routeRequest({
      method: 'POST',
      pathname: `/api/users/${walletAccountId}/local-wallet-installations/${walletInstallationId}/payment-method`,
      body: {
        cardBrand: 'visa',
        cardLast4: '4242',
        expMonth: 12,
        expYear: 2030
      }
    });
    assert.equal(linked.statusCode, 200);

    const requested = await client.request('tools/call', {
      name: 'request_wallet_charge',
      arguments: {
        walletAccountId,
        merchant: 'duffel',
        amountUsd: 90,
        memo: 'Flight booking charge',
        bookingReference: 'trip_mcp_pending_charge_1'
      }
    });

    assert.equal(requested.result.structuredContent.status, 'pending_approval');

    const pending = await client.request('tools/call', {
      name: 'list_wallet_requests',
      arguments: {
        walletAccountId
      }
    });

    assert.equal(pending.result.structuredContent.requestCount, 1);
    assert.equal(pending.result.structuredContent.requests[0].requestId, requested.result.structuredContent.requestId);

    const reviewed = await client.request('tools/call', {
      name: 'respond_wallet_request',
      arguments: {
        walletAccountId,
        relayRequestId: requested.result.structuredContent.requestId,
        decision: 'approve'
      }
    });

    assert.equal(reviewed.result.structuredContent.result.status, 'charged');
    assert.equal(reviewed.result.structuredContent.result.execution.provider, 'mock_stripe_wallet_charge');
  } finally {
    await client.close();
  }
});
