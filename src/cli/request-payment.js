import { parseArgs } from 'node:util';

import { loadAgentInstallation } from '../lib/agent-files.js';
import { requestJson } from '../lib/http-client.js';
import { createAgentClient } from '../lib/agent-client.js';

function dollarsToCents(amount) {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Amount must be a positive number in dollars.');
  }

  return Math.round(parsed * 100);
}

const { values } = parseArgs({
  options: {
    server: { type: 'string', default: 'http://localhost:3000' },
    agent: { type: 'string' },
    'wallet-account-id': { type: 'string' },
    merchant: { type: 'string' },
    'merchant-domain': { type: 'string' },
    amount: { type: 'string' },
    memo: { type: 'string' },
    currency: { type: 'string', default: 'USD' }
  }
});

if (!values.agent || !values['wallet-account-id'] || !values.merchant || !values.amount) {
  console.error(
    'Usage: npm run agent:pay -- --agent <agent-id-or-file> --wallet-account-id <wallet-id> --merchant <service> --amount <dollars> [--memo "Hotel hold"]'
  );
  process.exit(1);
}

const { installation } = await loadAgentInstallation(values.agent);
const client = createAgentClient({
  send: async (pathname, options) => {
    const data = await requestJson(`${values.server}${pathname}`, options);
    return {
      status: 200,
      data
    };
  }
});
const result = await client.requestPayment({
  installation,
  walletAccountId: values['wallet-account-id'],
  merchantId: values.merchant.trim(),
  merchantDomain: values['merchant-domain']?.trim() || values.merchant.trim(),
  amountMinor: dollarsToCents(values.amount),
  currency: values.currency.toUpperCase(),
  memo: values.memo?.trim() || ''
});

console.log(`Wallet response verified with key ${result.walletMeta.wallet.keyId}.`);
console.log(`Status: ${result.receipt.payload.status}`);
console.log(`Reason: ${result.receipt.payload.reasonCode}`);
console.log(`Payment id: ${result.receipt.payload.requestId}`);
console.log(
  `Balance remaining: $${(result.receipt.payload.balanceRemaining.minor / 100).toFixed(2)}`
);
if (result.receipt.payload.providerRef) {
  console.log(`Provider reference: ${result.receipt.payload.providerRef}`);
}
