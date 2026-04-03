import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

function createWalletPathResolver(walletDir) {
  function walletInstallationFilePath(walletInstallationId) {
    return join(walletDir, `${walletInstallationId}.json`);
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

  return {
    walletInstallationFilePath,
    resolveWalletPath
  };
}

export function createWalletInstallationStore({ walletDir = join(process.cwd(), 'local-wallet') } = {}) {
  const { walletInstallationFilePath, resolveWalletPath } = createWalletPathResolver(walletDir);

  return {
    walletDir,
    walletInstallationFilePath,
    async saveWalletInstallation(installation) {
      await mkdir(walletDir, { recursive: true });
      const filePath = walletInstallationFilePath(installation.walletInstallationId);
      await writeFile(filePath, JSON.stringify(installation, null, 2), 'utf8');
      return filePath;
    },
    async loadWalletInstallation(input) {
      const filePath = resolveWalletPath(input);
      const raw = await readFile(filePath, 'utf8');
      return { filePath, installation: JSON.parse(raw) };
    }
  };
}

const defaultStore = createWalletInstallationStore();

export const walletInstallationFilePath = defaultStore.walletInstallationFilePath;
export const saveWalletInstallation = defaultStore.saveWalletInstallation;
export const loadWalletInstallation = defaultStore.loadWalletInstallation;
