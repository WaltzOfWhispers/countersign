import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentWalletApp } from '../src/app.js';
import { resolveElectronAppConfig } from '../src/electron/config.js';

async function createHarness() {
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-electron-test-'));
  const app = createAgentWalletApp({
    dataFile: join(rootDir, 'data', 'store.json'),
    walletDir: join(rootDir, 'local-wallet')
  });
  await app.ensureWalletIdentity();

  async function requestPage(pathname) {
    return new Promise((resolve, reject) => {
      const response = {
        statusCode: 200,
        headers: {},
        writeHead(statusCode, headers = {}) {
          this.statusCode = statusCode;
          this.headers = headers;
        },
        end(body = '') {
          resolve({
            status: this.statusCode,
            headers: this.headers,
            body: body.toString()
          });
        }
      };

      app.handleRequest(
        {
          url: pathname,
          headers: { host: 'localhost:3210' },
          method: 'GET'
        },
        response
      ).catch(reject);
    });
  }

  return { requestPage };
}

test('electron shell page exposes a home-first app shell with isolated panels for wallet views', async () => {
  const harness = await createHarness();

  const response = await harness.requestPage('/electron.html');

  assert.equal(response.status, 200);
  assert.match(response.body, /existing-wallet-select/);
  assert.match(response.body, /desktop-sidebar/);
  assert.match(response.body, /desktop-brand/);
  assert.match(response.body, /desktop-sidebar-main/);
  assert.match(response.body, /desktop-sidebar-footer/);
  assert.match(response.body, /desktop-workspace/);
  assert.match(response.body, /banner-close-button/);
  assert.match(response.body, /Agent wallet/);
  assert.match(response.body, /data-tab="home"/);
  assert.match(response.body, /data-tab="requests"/);
  assert.match(response.body, /data-tab="transactions"/);
  assert.match(response.body, /data-tab="controls"/);
  assert.match(response.body, /data-tab="funding"/);
  assert.match(response.body, /data-tab="settings"/);
  assert.match(response.body, /home-panel/);
  assert.match(response.body, /wallet-account-id-card/);
  assert.match(response.body, /Wallet account ID/);
  assert.match(response.body, /requests-panel/);
  assert.match(response.body, /transactions-panel/);
  assert.match(response.body, /controls-panel/);
  assert.match(response.body, /funding-panel/);
  assert.match(response.body, /settings-panel/);
  assert.match(response.body, /id="home-panel" class="tab-panel active"/);
  assert.match(response.body, /id="requests-panel" class="tab-panel" hidden/);
  assert.match(response.body, /id="funding-panel" class="tab-panel" hidden/);
  assert.match(response.body, /id="stripe-config-status" class="callout muted" hidden/);
  assert.match(response.body, /stripe-payment-status/);
  assert.match(response.body, /funding-actions/);
  assert.match(response.body, /linked-payment-methods-list/);
  assert.match(response.body, /stripe-payment-form/);
  assert.match(response.body, /stripe-payment-element/);
  assert.match(response.body, /funding-usdc-balance/);
  assert.match(response.body, /funding-evm-address/);
  assert.match(response.body, /USDC balance/);
  assert.match(response.body, /Ethereum address/);
  assert.match(response.body, />Crypto</);
  assert.match(response.body, />Credit cards</);
  assert.match(response.body, /Your card will not be charged during setup/);
  assert.match(response.body, /Card details are collected securely by Stripe and are not stored by Countersign/);
  assert.doesNotMatch(response.body, /No USD wallet balance/);
  assert.doesNotMatch(response.body, /agent-pairing-code/);
  assert.doesNotMatch(response.body, /generate-agent-link-code-button/);
  assert.doesNotMatch(response.body, /linked-agents-list/);
  assert.doesNotMatch(response.body, />Agent pairing</);
  assert.doesNotMatch(response.body, /Generate security code/);
  assert.doesNotMatch(response.body, /fund-form/);
  assert.doesNotMatch(response.body, /generate-claim-token/);
  assert.doesNotMatch(response.body, /claim-token-card/);
  assert.doesNotMatch(response.body, /install-daemon-form/);
  assert.doesNotMatch(response.body, /claim-daemon-form/);
  assert.doesNotMatch(response.body, />Load Wallet</);
  assert.doesNotMatch(response.body, /refresh-button/);
  assert.doesNotMatch(response.body, /new-wallet-button/);
  assert.doesNotMatch(response.body, />Setup</);
  assert.doesNotMatch(response.body, /id="settings-panel"[\s\S]*fund-form/);
  assert.doesNotMatch(response.body, /id="settings-panel"[\s\S]*stripe-payment-form/);
});

test('electron app config resolves repo-local defaults and desktop server URL', () => {
  const config = resolveElectronAppConfig({
    env: {},
    cwd: '/tmp/not-the-project',
    importMetaUrl: 'file:///workspace/countersign/src/electron/main.js'
  });

  assert.equal(config.dataFile, '/workspace/countersign/data/store.json');
  assert.equal(config.walletDir, '/workspace/countersign/local-wallet');
  assert.equal(config.port, 3210);
  assert.equal(config.serverUrl, 'http://127.0.0.1:3210/electron.html');
});
