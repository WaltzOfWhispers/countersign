import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

test('Countersign pack output contains only the SDK package surface', async () => {
  const packDir = await mkdtemp(join(tmpdir(), 'countersign-pack-'));
  const cacheDir = await mkdtemp(join(tmpdir(), 'countersign-npm-cache-'));
  const { stdout } = await execFileAsync(
    'npm',
    ['pack', '--json', '--pack-destination', packDir],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        npm_config_cache: cacheDir
      }
    }
  );
  const [{ filename }] = JSON.parse(stdout);
  const tarballPath = join(packDir, filename);
  const tarList = await execFileAsync('tar', ['-tzf', tarballPath]);
  const files = tarList.stdout.trim().split('\n');

  assert(files.includes('package/package.json'));
  assert(files.includes('package/index.js'));
  assert(files.includes('package/src/sdk/index.js'));
  assert(files.includes('package/src/lib/canonical-json.js'));
  assert(files.includes('package/src/lib/crypto.js'));
  assert(files.includes('package/src/lib/http-client.js'));
  assert(files.includes('package/src/lib/ids.js'));

  assert.equal(files.some((file) => file.startsWith('package/test/')), false);
  assert.equal(files.some((file) => file.startsWith('package/public/')), false);
  assert.equal(files.includes('package/src/app.js'), false);
  assert.equal(files.includes('package/agent-wallet-prd.md'), false);
  assert.equal(files.includes('package/docs/travel-agent-integration.md'), false);
});
