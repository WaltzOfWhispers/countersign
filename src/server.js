import { createAgentWalletApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const app = createAgentWalletApp();

await app.start({ port });

console.log(`Countersign running at http://localhost:${port}`);
