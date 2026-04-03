import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const WALLET_DIR = join(process.cwd(), 'local-wallet');

export function walletInstallationFilePath(walletInstallationId) {
  return join(WALLET_DIR, `${walletInstallationId}.json`);
}

function resolveWalletPath(input) {
  if (!input) {
    throw new Error('Wallet file or wallet installation id is required.');
  }

  if (isAbsolute(input) || input.endsWith('.json') || input.includes('/')) {
    return input;
  }

  return walletInstallationFilePath(input);
}

export async function saveWalletInstallation(installation) {
  await mkdir(WALLET_DIR, { recursive: true });
  const filePath = walletInstallationFilePath(installation.walletInstallationId);
  await writeFile(filePath, JSON.stringify(installation, null, 2), 'utf8');
  return filePath;
}

export async function loadWalletInstallation(input) {
  const filePath = resolveWalletPath(input);
  const raw = await readFile(filePath, 'utf8');
  return { filePath, installation: JSON.parse(raw) };
}
