# Countersign

Countersign is a local agent wallet.

It gives you one desktop app to manage:

- payment methods
- spending controls
- incoming payment requests
- transaction history

Claude can use the same wallet through MCP, and a remote agent can request payment by sending a signed request to Countersign and waiting for wallet approval.

![Countersign desktop app](./docs/countersign-desktop.png)

## What It Is

Countersign has three surfaces:

1. The desktop app
   This is the main wallet UI. Use it to create or select a wallet, add cards, review requests, and change policy.
2. The MCP server
   This lets Claude use the local wallet from chat.
3. The SDK
   This lets another agent send signed payment requests to the wallet.

## How To Use It

### 1. Configure Stripe

Create a local `.env` file in the repo root:

```dotenv
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### 2. Start Countersign

```bash
npm install
npm start
npm run desktop:start
```

The desktop app is the main wallet surface.

### 3. Use The Desktop App

In the app:

1. Create or load a wallet in `Settings`
2. Add a card in `Funding`
3. Review incoming requests in `Requests`
4. Adjust policy in `Spending Controls`
5. Inspect completed charges in `Transactions`

### 4. Connect Claude

Add Countersign to Claude Desktop in:

`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "countersign": {
      "command": "/bin/bash",
      "args": [
        "-c",
        "cd /Users/christycui/Documents/agent_wallet && /Users/christycui/.nvm/versions/node/v24.11.1/bin/node src/mcp/server.js"
      ]
    }
  }
}
```

Then fully restart Claude Desktop.

The main wallet-owner tools are:

- `list_wallets`
- `create_wallet`
- `get_wallet`
- `link_wallet_payment_method`
- `list_wallet_cards`
- `set_default_wallet_card`
- `request_wallet_charge`
- `list_wallet_requests`
- `respond_wallet_request`

### 5. Connect A Remote Agent

Install the SDK in the other repo:

```bash
npm install github:WaltzOfWhispers/countersign
```

Set:

```dotenv
COUNTERSIGN_BASE_URL=http://127.0.0.1:3210
COUNTERSIGN_AGENT_ID=travel-agent
COUNTERSIGN_AGENT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
```

The user must share their `walletAccountId` with the remote agent.

Countersign must also trust that agent's public key through `COUNTERSIGN_TRUSTED_AGENTS_JSON`.

Minimal example:

```js
import { createCountersignClient } from 'countersign';

const client = createCountersignClient({
  baseUrl: process.env.COUNTERSIGN_BASE_URL,
  agentId: process.env.COUNTERSIGN_AGENT_ID,
  privateKeyPem: process.env.COUNTERSIGN_AGENT_PRIVATE_KEY
});

const relayRequest = await client.enqueueAuthorizationRequest({
  walletAccountId: 'user_123',
  amount: { currency: 'USD', minor: 2450 },
  bookingReference: 'trip_123',
  memo: 'Flight booking charge'
});

const result = await client.getAuthorizationResult({
  relayRequestId: relayRequest.relayRequestId
});
```

## Notes

- The desktop app is the primary approval surface.
- Claude approval is optional. Use it when you want to approve from chat instead of clicking in the app.
- Countersign does not store raw card details. Card entry goes through Stripe.
- The current MVP runs wallet-side charges with linked Stripe payment methods. It does not custody a USD balance in the desktop flow.

## More Detail

- MCP setup: [docs/mcp-server.md](/Users/christycui/Documents/agent_wallet/docs/mcp-server.md)
- Remote agent integration: [docs/travel-agent-integration.md](/Users/christycui/Documents/agent_wallet/docs/travel-agent-integration.md)
