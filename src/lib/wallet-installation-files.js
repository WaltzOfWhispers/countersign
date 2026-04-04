import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export function normalizeWalletInstallation(installation) {
  if (!installation || typeof installation !== 'object') {
    return installation;
  }

  const paymentMethods = Array.isArray(installation.paymentMethods)
    ? installation.paymentMethods.filter(Boolean).length > 0
      ? installation.paymentMethods.filter(Boolean)
      : installation.paymentMethod
        ? [installation.paymentMethod]
        : []
    : installation.paymentMethod
      ? [installation.paymentMethod]
      : [];

  const activePaymentMethodId =
    installation.activePaymentMethodId ||
    installation.paymentMethod?.paymentMethodId ||
    paymentMethods[0]?.paymentMethodId ||
    null;

  const activePaymentMethod =
    paymentMethods.find((paymentMethod) => paymentMethod.paymentMethodId === activePaymentMethodId) ||
    paymentMethods[0] ||
    null;

  return {
    ...installation,
    activePaymentMethodId: activePaymentMethod?.paymentMethodId || null,
    paymentMethod: activePaymentMethod,
    paymentMethods
  };
}

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
      await writeFile(filePath, JSON.stringify(normalizeWalletInstallation(installation), null, 2), 'utf8');
      return filePath;
    },
    async loadWalletInstallation(input) {
      const filePath = resolveWalletPath(input);
      const raw = await readFile(filePath, 'utf8');
      return { filePath, installation: normalizeWalletInstallation(JSON.parse(raw)) };
    },
    async listWalletInstallations() {
      await mkdir(walletDir, { recursive: true });
      const entries = await readdir(walletDir, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .sort((left, right) => left.name.localeCompare(right.name));

      const installations = await Promise.all(
        files.map(async (entry) => {
          const filePath = join(walletDir, entry.name);
          const raw = await readFile(filePath, 'utf8');
          return {
            filePath,
            installation: normalizeWalletInstallation(JSON.parse(raw))
          };
        })
      );

      return installations;
    },
    async updateWalletInstallation(input, mutator) {
      const { filePath, installation } = await this.loadWalletInstallation(input);
      const updatedInstallation = normalizeWalletInstallation(
        (await mutator({ ...installation })) || installation
      );
      await mkdir(walletDir, { recursive: true });
      await writeFile(filePath, JSON.stringify(updatedInstallation, null, 2), 'utf8');
      return { filePath, installation: updatedInstallation };
    }
  };
}

const defaultStore = createWalletInstallationStore();

export const walletInstallationFilePath = defaultStore.walletInstallationFilePath;
export const saveWalletInstallation = defaultStore.saveWalletInstallation;
export const loadWalletInstallation = defaultStore.loadWalletInstallation;
export const updateWalletInstallation = defaultStore.updateWalletInstallation;
