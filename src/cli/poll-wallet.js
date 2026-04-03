import { parseArgs } from 'node:util';

import { loadWalletInstallation } from '../lib/wallet-installation-files.js';
import { requestJson } from '../lib/http-client.js';
import { createWalletDaemonClient } from '../lib/wallet-daemon-client.js';

const { values } = parseArgs({
  options: {
    server: { type: 'string', default: 'http://localhost:3000' },
    wallet: { type: 'string' }
  }
});

if (!values.wallet) {
  console.error(
    'Usage: npm run wallet:poll -- --wallet <wallet-installation-id-or-file>'
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

const result = await client.pollRequests({ installation });

console.log(`Pending relay requests: ${result.requests.length}`);
for (const relayRequest of result.requests) {
  console.log(
    `${relayRequest.requestId} ${relayRequest.payload.agentId} $${(relayRequest.payload.amount.minor / 100).toFixed(2)} ${relayRequest.payload.memo || ''}`.trim()
  );
}
