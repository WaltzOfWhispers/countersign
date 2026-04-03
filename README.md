# Countersign

Countersign is the narrowed Phase 1 wedge for wallet-backed agent payment authorization:

- CLI/daemon wallet
- relay delivery between a remote travel-agent backend and the local wallet
- Stripe-style funding and travel-agent capture
- signed wallet authorization before the travel agent captures payment

The older local agent-auth demo is still present in the codebase, but the recommended path is the wallet-daemon + relay + travel-agent flow below.

## What is implemented

- Wallet account creation and mock Stripe top-up
- Wallet-daemon installation claim via signed proof
- Relay queue for signed remote travel-agent authorization requests
- Wallet-daemon polling and signed authorization receipts
- Mock Stripe travel-agent capture after wallet approval
- Policy checks for spend limits and approval threshold

## Core Flow

1. User creates a wallet and tops it up.
2. User installs a local wallet daemon and claims it to the wallet account.
3. Remote travel agent submits a signed authorization request to the relay.
4. Wallet daemon polls relay, signs approval, and sends the authorization back.
5. Travel agent captures the charge through the mock Stripe rail.

## Run It

1. Start the server:

```bash
npm start
```

If port `3000` is already in use:

```bash
PORT=3100 node src/server.js
```

2. Open the dashboard, create a wallet, fund it, and generate a claim token.

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

6. Approve a queued relay request:

```bash
npm run wallet:authorize -- --wallet <wallet-installation-id> --wallet-account-id <wallet-id> --request-id <relay-request-id>
```

## Key Files

- [src/app.js](/Users/christycui/Documents/agent_wallet/src/app.js): API routes, relay flow, wallet authorization, Stripe capture
- [src/lib/wallet-daemon-client.js](/Users/christycui/Documents/agent_wallet/src/lib/wallet-daemon-client.js): local daemon client
- [src/lib/payment-rails.js](/Users/christycui/Documents/agent_wallet/src/lib/payment-rails.js): mock Stripe top-up and travel-agent capture
- [docs/travel-agent-integration.md](/Users/christycui/Documents/agent_wallet/docs/travel-agent-integration.md): handoff spec for the travel-agent coder
- [test/wallet-daemon.integration.test.js](/Users/christycui/Documents/agent_wallet/test/wallet-daemon.integration.test.js): relay + daemon + travel-agent wedge tests
- [test/wallet-daemon-client.integration.test.js](/Users/christycui/Documents/agent_wallet/test/wallet-daemon-client.integration.test.js): daemon client integration test

## Notes

- Wallet daemon installs are stored in `local-wallet/`.
- Wallet balances are still modeled as a top-up balance in this MVP.
- Travel-agent capture is mocked as `mock_stripe_travel_charge`.
- The relay is implemented inside the same local server for the MVP, not as a separately deployed service.
