import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnvFile } from '../lib/env-file.js';

function projectRootFromImportMeta(importMetaUrl = import.meta.url) {
  return dirname(dirname(dirname(fileURLToPath(importMetaUrl))));
}

export function resolveElectronAppConfig({
  env = process.env,
  cwd = process.cwd(),
  importMetaUrl = import.meta.url
} = {}) {
  const projectRoot = projectRootFromImportMeta(importMetaUrl);
  const baseDir = projectRoot || cwd;
  loadEnvFile({ env, baseDir });
  const port = Number(env.COUNTERSIGN_ELECTRON_PORT || env.PORT || 3210);

  return {
    dataFile: env.COUNTERSIGN_DATA_FILE || join(baseDir, 'data', 'store.json'),
    walletDir: env.COUNTERSIGN_WALLET_DIR || join(baseDir, 'local-wallet'),
    publicDir: join(baseDir, 'public'),
    port,
    serverUrl: `http://127.0.0.1:${port}/electron.html`
  };
}
