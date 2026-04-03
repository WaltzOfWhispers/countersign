import { parseArgs } from 'node:util';

import { loadWalletInstallation } from '../lib/wallet-installation-files.js';
import { requestJson } from '../lib/http-client.js';
import { createWalletDaemonClient } from '../lib/wallet-daemon-client.js';

const { values } = parseArgs({
  options: {
    server: { type: 'string', default: 'http://localhost:3000' },
    wallet: { type: 'string' },
    'wallet-account-id': { type: 'string' },
    'claim-token': { type: 'string' },
    label: { type: 'string' }
  }
});

if (!values.wallet || !values['wallet-account-id'] || !values['claim-token']) {
  console.error(
    'Usage: npm run wallet:claim -- --wallet <wallet-installation-id-or-file> --wallet-account-id <wallet-id> --claim-token <token> [--label "CLI daemon"]'
  );
  process.exit(1);
}

const { installation } = await loadWalletInstallation(values.wallet);
const client = createWalletDaemonClient({
  send: async (pathname, options) => {
    const data = await requestJson(`${values.server}${pathname}`, options);
    return { status: 200, data };
  }
});

const result = await client.claimInstallation({
  installation: {
    ...installation,
    label: values.label?.trim() || installation.label
  },
  walletAccountId: values['wallet-account-id'],
  claimToken: values['claim-token']
});

console.log(`Claimed wallet daemon ${result.walletInstallation.id} to wallet ${values['wallet-account-id']}.`);
console.log(`Label: ${result.walletInstallation.label}`);
