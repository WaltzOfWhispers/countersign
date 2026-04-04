import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { createConfiguredAgentWalletApp } from '../src/server.js';
import { resolveMcpServerPaths } from '../src/mcp/server.js';

test('dashboard server uses the same env-configured store paths as the MCP server', () => {
  const app = createConfiguredAgentWalletApp({
    env: {
      COUNTERSIGN_DATA_FILE: '/tmp/countersign-custom-store.json',
      COUNTERSIGN_WALLET_DIR: '/tmp/countersign-custom-wallets'
    },
    cwd: '/workspace/countersign'
  });

  assert.equal(app.dataFile, '/tmp/countersign-custom-store.json');
  assert.equal(app.walletDir, '/tmp/countersign-custom-wallets');
});

test('dashboard server falls back to repo-local defaults when env vars are unset', () => {
  const app = createConfiguredAgentWalletApp({
    env: {},
    cwd: '/workspace/countersign'
  });

  assert.equal(app.dataFile, join('/workspace/countersign', 'data', 'store.json'));
  assert.equal(app.walletDir, join('/workspace/countersign', 'local-wallet'));
});

test('MCP server resolves default store paths from the project root instead of process cwd', () => {
  const paths = resolveMcpServerPaths({
    env: {},
    cwd: '/tmp/not-the-project',
    importMetaUrl: 'file:///workspace/countersign/src/mcp/server.js'
  });

  assert.equal(paths.dataFile, '/workspace/countersign/data/store.json');
  assert.equal(paths.walletDir, '/workspace/countersign/local-wallet');
});

test('MCP server still honors explicit env overrides', () => {
  const paths = resolveMcpServerPaths({
    env: {
      COUNTERSIGN_DATA_FILE: '/tmp/countersign-mcp-store.json',
      COUNTERSIGN_WALLET_DIR: '/tmp/countersign-mcp-wallets'
    },
    cwd: '/tmp/not-the-project',
    importMetaUrl: 'file:///workspace/countersign/src/mcp/server.js'
  });

  assert.equal(paths.dataFile, '/tmp/countersign-mcp-store.json');
  assert.equal(paths.walletDir, '/tmp/countersign-mcp-wallets');
});
