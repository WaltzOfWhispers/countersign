import { join } from 'node:path';

import { createAgentWalletApp } from './app.js';
import { loadEnvFile } from './lib/env-file.js';

function parseTrustedAgents(value) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    throw new Error('COUNTERSIGN_TRUSTED_AGENTS_JSON must be valid JSON.');
  }
}

export function createConfiguredAgentWalletApp({
  env = process.env,
  cwd = process.cwd()
} = {}) {
  loadEnvFile({ env, baseDir: cwd });

  return createAgentWalletApp({
    dataFile: env.COUNTERSIGN_DATA_FILE || join(cwd, 'data', 'store.json'),
    walletDir: env.COUNTERSIGN_WALLET_DIR || join(cwd, 'local-wallet'),
    trustedAgents: parseTrustedAgents(env.COUNTERSIGN_TRUSTED_AGENTS_JSON)
  });
}

export async function startConfiguredServer({
  env = process.env,
  cwd = process.cwd()
} = {}) {
  const port = Number(env.PORT || 3000);
  const app = createConfiguredAgentWalletApp({ env, cwd });

  await app.start({ port });

  return { app, port };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { port } = await startConfiguredServer();
  console.log(`Countersign running at http://localhost:${port}`);
}
