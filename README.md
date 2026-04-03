# Countersign

Countersign is a wallet for agent-initiated payments where trust is the product.

Most "agent wallets" today answer the custody question before they answer the identity question. They can keep keys in a TEE, on a server, or on a local machine, but they still struggle with the harder problem: when a remote agent asks to spend money, how does the wallet know which agent is asking, and how does the agent know the approval really came from the user's wallet rather than an intermediary?

Countersign is built around that gap. The travel agent signs the payment request. The user-run wallet daemon verifies the requester, checks local policy, and signs the authorization itself. The relay only routes messages. It does not become the trust anchor, and it does not sign on the wallet's behalf.

## Why This Exists

API keys and session tokens are good enough for many integrations, but they are weak foundations for autonomous spending. They identify an application session, not the specific actor asking to move money right now. That distinction matters once an agent can trigger charges without a human clicking through every payment flow.

Countersign takes the position that an agent payment system should be explicit about who is requesting spend, who is approving it, and what cryptographic proof exists on both sides. The point is not to add more wallet UX. The point is to make agent-initiated payments legible and verifiable.

## How It Works

In the current wedge, the user installs a local wallet daemon and claims it to a wallet account. That daemon has its own persistent Ed25519 keypair. Separately, the remote travel agent backend has its own keypair. When the travel agent wants to charge the user, it sends a signed authorization request through the relay. The wallet daemon polls the relay, verifies the travel agent's signature, evaluates the user's local policy, and returns a signed authorization receipt. Only after that receipt exists does the travel agent capture payment through the Stripe rail.

That means the approval path is anchored in the user's local wallet, not in the relay and not in the travel agent backend. The relay makes remote reachability possible. It does not replace wallet trust.

## SDK Surface

Countersign now exposes a packaged travel-agent SDK from the package root. The travel agent does not need to reimplement canonical JSON signing, relay request construction, or wallet receipt verification itself.

From a separate repo today, install it directly from GitHub:

```bash
npm install github:WaltzOfWhispers/countersign
```

```js
import { createCountersignClient } from 'countersign';

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

if (authorization.receipt.payload.status === 'approved') {
  await client.captureAuthorizedCharge({
    relayRequestId: relayRequest.relayRequestId
  });
}
```

## Current Phase 1 Wedge

This repository is intentionally narrow. It is not yet a general-purpose wallet for every agent and every rail. It is a proof of one opinionated loop: a remote travel agent business requests payment, a local wallet daemon authorizes it, and the business captures the charge only after receiving a wallet-signed receipt. In practice that means a local CLI or daemon wallet, a relay embedded in the MVP server, a remote travel agent backend as the requester, and a Stripe-style capture path after wallet authorization.

The purpose of this MVP is to validate the trust model before expanding into mobile custody, broader agent distribution, or additional payment rails.

## Local Flow

1. The user creates a wallet and funds it.
2. The user installs a local wallet daemon and claims it to the wallet account with a signed proof.
3. The travel agent submits a signed authorization request to the relay for that wallet account.
4. The wallet daemon polls the relay, verifies the request, applies policy, and signs the authorization.
5. The travel agent reads the wallet-signed receipt and captures the payment.

## Integration Contract

If you are implementing the remote travel agent side, the handoff contract is in [docs/travel-agent-integration.md](/Users/christycui/Documents/agent_wallet/docs/travel-agent-integration.md). It documents the request and response shapes, signing rules, onboarding assumptions, and the SDK methods the travel agent should call in this MVP.

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

1. Open the dashboard and create a wallet.
2. Fund the wallet and generate a claim token.
3. Install a local wallet daemon:

```bash
npm run wallet:install -- --label "CLI daemon"
```

4. Claim it to the wallet account:

```bash
npm run wallet:claim -- --wallet <wallet-installation-id> --wallet-account-id <wallet-id> --claim-token <token>
```

5. Poll for relay requests:

```bash
npm run wallet:poll -- --wallet <wallet-installation-id>
```

6. Authorize a queued request:

```bash
npm run wallet:authorize -- --wallet <wallet-installation-id> --wallet-account-id <wallet-id> --request-id <relay-request-id>
```

## Code Map

The trust and relay flow lives primarily in [src/app.js](/Users/christycui/Documents/agent_wallet/src/app.js). The packaged travel-agent SDK lives in [src/sdk/index.js](/Users/christycui/Documents/agent_wallet/src/sdk/index.js). The local wallet client is in [src/lib/wallet-daemon-client.js](/Users/christycui/Documents/agent_wallet/src/lib/wallet-daemon-client.js). The mocked payment rail lives in [src/lib/payment-rails.js](/Users/christycui/Documents/agent_wallet/src/lib/payment-rails.js). The end-to-end wedge is covered by [test/wallet-daemon.integration.test.js](/Users/christycui/Documents/agent_wallet/test/wallet-daemon.integration.test.js), [test/wallet-daemon-client.integration.test.js](/Users/christycui/Documents/agent_wallet/test/wallet-daemon-client.integration.test.js), and [test/countersign-sdk.integration.test.js](/Users/christycui/Documents/agent_wallet/test/countersign-sdk.integration.test.js).

## Notes

This repository still contains the earlier local agent-auth demo paths. They are no longer the primary story. The recommended path is the wallet daemon plus relay plus travel-agent flow described above.
