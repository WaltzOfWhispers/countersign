import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { createConfiguredAgentWalletApp } from '../src/server.js';
import { resolveMcpServerPaths } from '../src/mcp/server.js';
import { resolveElectronAppConfig } from '../src/electron/config.js';

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

test('dashboard server loads repo-local .env defaults when process env is unset', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-env-config-test-'));
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, '.env'),
    'COUNTERSIGN_DATA_FILE=/tmp/from-env-store.json\nCOUNTERSIGN_WALLET_DIR=/tmp/from-env-wallets\n',
    'utf8'
  );

  const app = createConfiguredAgentWalletApp({
    env: {},
    cwd: rootDir
  });

  assert.equal(app.dataFile, '/tmp/from-env-store.json');
  assert.equal(app.walletDir, '/tmp/from-env-wallets');
});

test('electron config loads repo-local .env defaults when process env is unset', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-electron-env-test-'));
  await writeFile(join(rootDir, '.env'), 'COUNTERSIGN_ELECTRON_PORT=4567\n', 'utf8');

  const config = resolveElectronAppConfig({
    env: {},
    cwd: rootDir,
    importMetaUrl: `file://${join(rootDir, 'src', 'electron', 'main.js')}`
  });

  assert.equal(config.port, 4567);
  assert.equal(config.serverUrl, 'http://127.0.0.1:4567/electron.html');
});
