import { parseArgs } from 'node:util';

import { saveAgentInstallation } from '../lib/agent-files.js';
import { generateEd25519Keypair } from '../lib/crypto.js';
import { createId, nowIsoTimestamp } from '../lib/ids.js';

const { values } = parseArgs({
  options: {
    label: { type: 'string' }
  }
});

const agentId = createId('agent');
const keys = generateEd25519Keypair();
const installation = {
  agentId,
  label: values.label?.trim() || 'Local MCP install',
  createdAt: nowIsoTimestamp(),
  ...keys
};

const filePath = await saveAgentInstallation(installation);

console.log(`Installed agent identity: ${installation.agentId}`);
console.log(`Saved installation: ${filePath}`);
console.log('');
console.log('Next steps:');
console.log('1. Start the wallet server with `npm start`.');
console.log('2. Open the dashboard on your configured local server URL and create a wallet.');
console.log('3. Copy the wallet id and generate a claim token in the dashboard.');
console.log(
  `4. Claim this agent with \`npm run agent:claim -- --agent ${installation.agentId} --wallet-account-id <wallet-id> --claim-token <token>\`.`
);
