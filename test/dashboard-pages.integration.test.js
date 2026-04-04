import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentWalletApp } from '../src/app.js';

async function createHarness() {
  const rootDir = await mkdtemp(join(tmpdir(), 'countersign-pages-test-'));
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
          headers: { host: 'localhost:3200' },
          method: 'GET'
        },
        response
      ).catch(reject);
    });
  }

  return { app, requestPage };
}

test('root page serves the desktop shell as the only local UI surface', async () => {
  const harness = await createHarness();

  const response = await harness.requestPage('/');

  assert.equal(response.status, 200);
  assert.match(response.body, /existing-wallet-select/);
  assert.match(response.body, /data-tab="home"/);
  assert.match(response.body, /data-tab="funding"/);
  assert.match(response.body, /data-tab="settings"/);
  assert.match(response.body, /fund-form/);
  assert.match(response.body, /payment-method-form/);
  assert.doesNotMatch(response.body, /href="\/setup\.html"/);
});

test('legacy setup page is no longer served', async () => {
  const harness = await createHarness();

  const response = await harness.requestPage('/setup.html');

  assert.equal(response.status, 404);
  assert.match(response.body, /Not found\./);
});
