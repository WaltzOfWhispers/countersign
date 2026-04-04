# Countersign

Countersign is a wallet for agent-initiated payments where trust is the product.

Most "agent wallets" today answer the custody question before they answer the identity question. They can keep keys in a TEE, on a server, or on a local machine, but they still struggle with the harder problem: when a remote agent asks to spend money, how does the wallet know which agent is asking, and how does the agent know the approval really came from the user's wallet rather than an intermediary?

Countersign is built around that gap. The travel agent signs the payment request. The user-run wallet daemon verifies the requester, checks local policy, and signs the authorization itself. The relay only routes messages. It does not become the trust anchor, and it does not sign on the wallet's behalf.

For the current travel-agent wedge, the wallet can also hold a local Stripe-style payment-method reference. That means the travel agent asks Countersign for approval, the wallet approves, and the wallet runs the charge on behalf of the travel agent. The travel agent remains the merchant. Countersign remains the trust and payment-orchestration layer.

The local agent wallet app is now part of that loop, not just a read-only admin page. Once the desktop app is running, you can create the wallet, manage funding, attach a local payment method, and review live travel-agent requests from one local surface.

## MCP Setup

Countersign also includes a local MCP server so Claude can perform wallet actions directly. The MCP server talks to the same Countersign data store and local wallet installation files, so Claude can create wallets, generate claim tokens, install and claim local wallet identities, inspect pending requests, and approve or reject them.

From the Countersign repo, start it with:

```bash
npm run mcp:start
```

Then replace `/absolute/path/to/countersign` below and paste this prompt into Claude:

```text
Please add a local MCP server named "countersign" with:

- command: npm
- args: run mcp:start
- cwd: /absolute/path/to/countersign

After installation, confirm these tools are available:
- create_wallet
- get_wallet
- fund_wallet
- set_wallet_policy
- generate_claim_token
- install_wallet_daemon
- link_wallet_payment_method
- claim_wallet_daemon
- list_pending_wallet_requests
- review_wallet_request
```

The MCP server exposes these wallet tools:

- `create_wallet`
- `get_wallet`
- `fund_wallet`
- `set_wallet_policy`
- `generate_claim_token`
- `install_wallet_daemon`
- `link_wallet_payment_method`
- `claim_wallet_daemon`
- `list_pending_wallet_requests`
- `review_wallet_request`

If you want the MCP server to use a different store location, set:

- `COUNTERSIGN_DATA_FILE`
- `COUNTERSIGN_WALLET_DIR`
- `COUNTERSIGN_TRUSTED_AGENTS_JSON` for local testing with known travel-agent keys

The MCP-specific setup doc is in [docs/mcp-server.md](/Users/christycui/Documents/agent_wallet/docs/mcp-server.md).

## SDK Setup

The travel-agent SDK is the right surface for your separate travel agent repo. It wraps the signed relay protocol so the travel agent does not have to reimplement canonical JSON signing, relay request construction, or wallet receipt verification itself.

The recommended flow is:

1. travel agent enqueues a payment request
2. local wallet daemon or Claude approves it
3. if the wallet has a linked local payment method, the wallet runs the Stripe-style charge
4. travel agent polls Countersign for the final charged result

Install it from GitHub in the travel-agent repo:

```bash
npm install github:WaltzOfWhispers/countersign
```

Then import it:

```js
import { createCountersignClient } from 'countersign';
```

Construct the client with the Countersign base URL, the travel agent's persistent `agentId`, and the travel agent private key:

```js
const client = createCountersignClient({
  baseUrl: 'https://wallet.example.com',
  agentId: 'travel-agent',
  privateKeyPem: process.env.COUNTERSIGN_AGENT_PRIVATE_KEY
});

const relayRequest = await client.enqueueAuthorizationRequest({
  walletAccountId: 'user_123',
  amount: { currency: 'USD', minor: 2450 },
  bookingReference: 'trip_123',
  memo: 'Flight booking charge'
});

const authorization = await client.getAuthorizationResult({
  relayRequestId: relayRequest.relayRequestId
});

if (authorization.status === 'charged') {
  console.log(authorization.execution);
}
```

The full travel-agent handoff contract is in [docs/travel-agent-integration.md](/Users/christycui/Documents/agent_wallet/docs/travel-agent-integration.md).

## Why This Exists

API keys and session tokens are good enough for many integrations, but they are weak foundations for autonomous spending. They identify an application session, not the specific actor asking to move money right now. That distinction matters once an agent can trigger charges without a human clicking through every payment flow.

Countersign takes the position that an agent payment system should be explicit about who is requesting spend, who is approving it, and what cryptographic proof exists on both sides. The point is not to add more wallet UX. The point is to make agent-initiated payments legible and verifiable.

## How It Works

In the current wedge, the user installs a local wallet daemon and claims it to a wallet account. That daemon has its own persistent Ed25519 keypair and can hold a local Stripe-style payment-method reference. Separately, the remote travel agent backend has its own keypair. When the travel agent wants to charge the user, it sends a signed authorization request through the relay. The wallet daemon polls the relay, verifies the travel agent's signature, evaluates the user's local policy, and returns a signed authorization receipt. If the wallet has a linked payment method, it also runs the mock Stripe charge on behalf of the travel agent and returns that execution result through the relay.

That means the approval path and the charge path are anchored in the user's local wallet, not in the relay and not in the travel agent backend. The relay makes remote reachability possible. It does not replace wallet trust.

## Current Phase 1 Wedge

This repository is intentionally narrow. It is not yet a general-purpose wallet for every agent and every rail. It is a proof of one opinionated loop: a remote travel agent business requests payment, a local wallet daemon authorizes it, and the wallet runs the Stripe-style charge on behalf of the travel agent after approval. In practice that means a local CLI or daemon wallet, a relay embedded in the MVP server, a remote travel agent backend as the requester, and a Stripe-style charge path triggered by wallet approval.

The purpose of this MVP is to validate the trust model before expanding into mobile custody, broader agent distribution, or additional payment rails.

## Local Flow

1. The user creates a wallet.
2. The user installs a local wallet daemon, links a local payment method, and claims the daemon to the wallet account with a signed proof.
3. The travel agent submits a signed authorization request to the relay for that wallet account.
4. The wallet daemon polls the relay, verifies the request, applies policy, signs the authorization, and runs the Stripe-style charge if a payment method is linked.
5. The travel agent reads the wallet-signed receipt and final charge result from the relay.

## Integration Contract

If you are implementing the remote travel agent side, the handoff contract is in [docs/travel-agent-integration.md](/Users/christycui/Documents/agent_wallet/docs/travel-agent-integration.md). If you are wiring Claude into local wallet control, use [docs/mcp-server.md](/Users/christycui/Documents/agent_wallet/docs/mcp-server.md).

## Run It

Start the server:

```bash
npm start
```

If port `3000` is already in use:

```bash
PORT=3100 node src/server.js
```

Then:

1. Start the desktop app:

```bash
npm run desktop:start
```

2. Create a wallet and manage controls, funding, and requests from the local app.
3. If you want the CLI path instead of the desktop app, install a local wallet daemon:

```bash
npm run wallet:install -- --label "CLI daemon"
```

4. CLI fallback: link a local payment method reference:

```bash
npm run wallet:link-payment-method -- --wallet <wallet-installation-id> --card-brand visa --card-last4 4242 --exp-month 12 --exp-year 2030
```

5. CLI fallback: claim it to the wallet account:

```bash
npm run wallet:claim -- --wallet <wallet-installation-id> --wallet-account-id <wallet-id> --claim-token <token>
```

6. CLI fallback: poll for relay requests:

```bash
npm run wallet:poll -- --wallet <wallet-installation-id>
```

7. CLI fallback: authorize a queued request:

```bash
npm run wallet:authorize -- --wallet <wallet-installation-id> --wallet-account-id <wallet-id> --request-id <relay-request-id>
```

## Code Map

The trust and relay flow lives primarily in [src/app.js](/Users/christycui/Documents/agent_wallet/src/app.js). The packaged travel-agent SDK lives in [src/sdk/index.js](/Users/christycui/Documents/agent_wallet/src/sdk/index.js). The local wallet client is in [src/lib/wallet-daemon-client.js](/Users/christycui/Documents/agent_wallet/src/lib/wallet-daemon-client.js). The mocked payment rail lives in [src/lib/payment-rails.js](/Users/christycui/Documents/agent_wallet/src/lib/payment-rails.js). The end-to-end wedge is covered by [test/wallet-daemon.integration.test.js](/Users/christycui/Documents/agent_wallet/test/wallet-daemon.integration.test.js), [test/wallet-daemon-client.integration.test.js](/Users/christycui/Documents/agent_wallet/test/wallet-daemon-client.integration.test.js), and [test/countersign-sdk.integration.test.js](/Users/christycui/Documents/agent_wallet/test/countersign-sdk.integration.test.js).

## Notes

This repository still contains the earlier local agent-auth demo paths. They are no longer the primary story. The recommended path is the wallet daemon plus relay plus travel-agent flow described above.
