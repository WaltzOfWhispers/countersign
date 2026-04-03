import { parseArgs } from 'node:util';

import { loadAgentInstallation } from '../lib/agent-files.js';
import { requestJson } from '../lib/http-client.js';
import { createAgentClient } from '../lib/agent-client.js';

const { values } = parseArgs({
  options: {
    server: { type: 'string', default: 'http://localhost:3000' },
    agent: { type: 'string' },
    'wallet-account-id': { type: 'string' },
    'claim-token': { type: 'string' },
    label: { type: 'string' }
  }
});

if (!values.agent || !values['wallet-account-id'] || !values['claim-token']) {
  console.error(
    'Usage: npm run agent:claim -- --agent <agent-id-or-file> --wallet-account-id <wallet-id> --claim-token <token> [--label "Travel agent"]'
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
const result = await client.claimInstallation({
  installation,
  claimToken: values['claim-token'],
  walletAccountId: values['wallet-account-id'],
  label: values.label?.trim() || installation.label
});

console.log(`Claimed agent ${result.agent.id} to wallet ${result.summary.user.id}.`);
console.log(`Label: ${result.agent.label}`);
