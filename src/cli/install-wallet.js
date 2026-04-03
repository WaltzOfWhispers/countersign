import { parseArgs } from 'node:util';

import { generateEd25519Keypair } from '../lib/crypto.js';
import { createId, nowIsoTimestamp } from '../lib/ids.js';
import { saveWalletInstallation } from '../lib/wallet-installation-files.js';

const { values } = parseArgs({
  options: {
    label: { type: 'string' }
  }
});

const walletInstallationId = createId('wallet_install');
const keys = generateEd25519Keypair();
const installation = {
  walletInstallationId,
  label: values.label?.trim() || 'CLI daemon',
  createdAt: nowIsoTimestamp(),
  ...keys
};

const filePath = await saveWalletInstallation(installation);

console.log(`Installed wallet daemon identity: ${walletInstallationId}`);
console.log(`Saved installation: ${filePath}`);
console.log('');
console.log('Next steps:');
console.log('1. Start the wallet server with `npm start`.');
console.log('2. Create a wallet in the dashboard and generate a claim token.');
console.log(
  `3. Claim this daemon with \`npm run wallet:claim -- --wallet ${walletInstallationId} --wallet-account-id <wallet-id> --claim-token <token>\`.`
);
