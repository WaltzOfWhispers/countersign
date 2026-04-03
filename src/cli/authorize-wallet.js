import { parseArgs } from 'node:util';

import { loadWalletInstallation } from '../lib/wallet-installation-files.js';
import { requestJson } from '../lib/http-client.js';
import { createWalletDaemonClient } from '../lib/wallet-daemon-client.js';

const { values } = parseArgs({
  options: {
    server: { type: 'string', default: 'http://localhost:3000' },
    wallet: { type: 'string' },
    'wallet-account-id': { type: 'string' },
    'request-id': { type: 'string' }
  }
});

if (!values.wallet || !values['wallet-account-id'] || !values['request-id']) {
  console.error(
    'Usage: npm run wallet:authorize -- --wallet <wallet-installation-id-or-file> --wallet-account-id <wallet-id> --request-id <relay-request-id>'
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

const poll = await client.pollRequests({ installation });
const relayRequest = poll.requests.find((request) => request.requestId === values['request-id']);

if (!relayRequest) {
  console.error(`Relay request ${values['request-id']} was not found in the pending queue.`);
  process.exit(1);
}

const result = await client.authorizeRequest({
  installation,
  relayRequest,
  walletAccountId: values['wallet-account-id']
});

console.log(`Authorized relay request ${result.relayRequestId}.`);
console.log(`Status: ${result.status}`);
