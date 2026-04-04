import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DEFAULT_STORE = {
  version: 1,
  walletIdentity: null,
  users: {},
  walletInstallations: {},
  agents: {},
  claimTokens: {},
  relayRequests: {},
  challenges: {},
  paymentRequests: {}
};

function hydrateStore(rawStore = {}) {
  return {
    ...DEFAULT_STORE,
    ...rawStore,
    users: rawStore.users || {},
    walletInstallations: rawStore.walletInstallations || {},
    agents: rawStore.agents || {},
    claimTokens: rawStore.claimTokens || {},
    relayRequests: rawStore.relayRequests || {},
    challenges: rawStore.challenges || {},
    paymentRequests: rawStore.paymentRequests || {}
  };
}

export function createStore(dataFile) {
  let writeQueue = Promise.resolve();

  async function writeStore(store) {
    await mkdir(dirname(dataFile), { recursive: true });
    const tempFile = `${dataFile}.tmp`;
    await writeFile(tempFile, JSON.stringify(store, null, 2), 'utf8');
    await rename(tempFile, dataFile);
  }

  async function ensureStoreFile() {
    await mkdir(dirname(dataFile), { recursive: true });

    try {
      await readFile(dataFile, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }

      await writeStore(DEFAULT_STORE);
    }
  }

  async function readCurrentStore() {
    await ensureStoreFile();
    const raw = await readFile(dataFile, 'utf8');
    return hydrateStore(JSON.parse(raw));
  }

  async function updateStore(mutator) {
    const operation = writeQueue.then(async () => {
      const store = await readCurrentStore();
      const result = await mutator(store);
      await writeStore(store);
      return { store, result };
    });

    writeQueue = operation.then(
      () => undefined,
      () => undefined
    );

    return operation;
  }

  return {
    dataFile,
    readStore: readCurrentStore,
    updateStore
  };
}
