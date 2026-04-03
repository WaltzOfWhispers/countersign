import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

import { createCountersignClient } from 'countersign';

const execFileAsync = promisify(execFile);

test('package root exports the Countersign travel-agent SDK', () => {
  assert.equal(typeof createCountersignClient, 'function');
});

test('a separate app can install the Countersign tarball and import the SDK', async () => {
  const packDir = await mkdtemp(join(tmpdir(), 'countersign-pack-install-'));
  const cacheDir = await mkdtemp(join(tmpdir(), 'countersign-install-cache-'));
  const consumerDir = await mkdtemp(join(tmpdir(), 'countersign-consumer-'));

  const packResult = await execFileAsync('npm', ['pack', '--json', '--pack-destination', packDir], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      npm_config_cache: cacheDir
    }
  });
  const [{ filename }] = JSON.parse(packResult.stdout);
  const tarballPath = join(packDir, filename);

  await writeFile(
    join(consumerDir, 'package.json'),
    JSON.stringify(
      {
        name: 'countersign-consumer',
        private: true,
        type: 'module'
      },
      null,
      2
    )
  );

  await execFileAsync('npm', ['install', tarballPath], {
    cwd: consumerDir,
    env: {
      ...process.env,
      npm_config_cache: cacheDir
    }
  });

  await writeFile(
    join(consumerDir, 'index.mjs'),
    [
      "import { createCountersignClient } from 'countersign';",
      '',
      "const client = createCountersignClient({",
      "  agentId: 'travel-agent',",
      "  privateKeyPem: 'unused-for-construction',",
      "  send: async () => ({ status: 200, data: {} })",
      '});',
      '',
      "console.log(typeof client.enqueueAuthorizationRequest);"
    ].join('\n')
  );

  const run = await execFileAsync('node', ['index.mjs'], {
    cwd: consumerDir
  });

  assert.equal(run.stdout.trim(), 'function');
});
