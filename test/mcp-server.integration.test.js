import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { createAgentWalletApp } from '../src/app.js';
import { generateEd25519Keypair, signPayload, verifyPayload } from '../src/lib/crypto.js';

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

    assert(toolNames.includes('create_wallet'));
    assert(toolNames.includes('get_wallet'));
    assert(toolNames.includes('install_wallet_daemon'));
    assert(toolNames.includes('link_wallet_payment_method'));
    assert(toolNames.includes('review_wallet_request'));
  } finally {
    await client.close();
  }
});

test('Countersign MCP tools can create, fund, install, and claim a local wallet daemon', async () => {
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

    const paymentMethod = await client.request('tools/call', {
      name: 'link_wallet_payment_method',
      arguments: {
        walletInstallationId,
        cardBrand: 'visa',
        cardLast4: '4242',
        expMonth: 12,
        expYear: 2030
      }
    });
    assert.equal(paymentMethod.result.structuredContent.paymentMethod.paymentMethodId.startsWith('pm_'), true);

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

test('Countersign MCP tools can list and approve pending travel-agent requests', async () => {
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
      name: 'link_wallet_payment_method',
      arguments: {
        walletInstallationId,
        cardBrand: 'visa',
        cardLast4: '4242',
        expMonth: 12,
        expYear: 2030
      }
    });

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

    assert.equal(review.result.structuredContent.status, 'charged');
    assert.equal(review.result.structuredContent.execution.provider, 'mock_stripe_wallet_charge');

    const agentView = await app.routeRequest({
      method: 'GET',
      pathname: `/api/relay/travel-agent/requests/${relayPayload.requestId}`
    });

    assert.equal(agentView.statusCode, 200);
    assert.equal(agentView.payload.status, 'charged');
    assert.equal(agentView.payload.execution.provider, 'mock_stripe_wallet_charge');
    assert.equal(
      verifyPayload(
        agentView.payload.receipt.payload,
        agentView.payload.receipt.signature,
        agentView.payload.walletInstallation.publicKeyPem
      ),
      true
    );
  } finally {
    await client.close();
  }
});
