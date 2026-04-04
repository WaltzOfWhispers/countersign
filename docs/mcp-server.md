# Countersign MCP Server

Countersign ships with a local MCP server so Claude can perform wallet actions against the same local Countersign state.

Run it from the repo root:

```bash
npm run mcp:start
```

## What It Can Do

The MCP server exposes these Claude-first wallet tools:

- `list_wallets`
- `create_wallet`
- `get_wallet`
- `set_wallet_policy`
- `list_wallet_cards`
- `set_default_wallet_card`
- `request_wallet_charge`
- `list_wallet_requests`
- `respond_wallet_request`
- `link_wallet_payment_method`

`respond_wallet_request` is for the wallet owner. It is the conversational equivalent of approving or rejecting a pending request in the desktop app.

The desktop app is still the primary approval surface. Claude is optional when you want to approve from chat instead of clicking in the app.

It also still exposes the lower-level runtime tools used by older flows:

- `generate_claim_token`
- `install_wallet_daemon`
- `claim_wallet_daemon`
- `list_pending_wallet_requests`
- `review_wallet_request`

`review_wallet_request` is legacy. Prefer `list_wallet_requests` + `respond_wallet_request` unless you are working directly with runtime ids.

This means Claude can:

- create a wallet
- set spending policy
- start a real Stripe card-link flow for the local wallet runtime
- inspect saved cards and set the default charge card
- request a local wallet charge directly
- inspect pending wallet approvals without knowing runtime ids
- approve or reject those pending wallet requests on behalf of the wallet owner

## Linking A Card From MCP

`link_wallet_payment_method` is a two-step tool:

1. Call it with:
   - `walletInstallationId`
   - `walletAccountId`

   Countersign returns:
   - `checkoutUrl`
   - `checkoutSessionId`
   - `nextAction: "complete_stripe_checkout"`

2. Open `checkoutUrl` in a browser and finish the Stripe flow.

3. Call the same tool again with:
   - `walletInstallationId`
   - `walletAccountId`
   - `checkoutSessionId`

   Countersign syncs the real Stripe payment method into the local wallet runtime.

## Requesting A Charge From Claude

The local-wallet flow is now:

1. `list_wallets`
2. `create_wallet`
3. `get_wallet`
4. `link_wallet_payment_method`
5. `list_wallet_cards`
6. optional `set_default_wallet_card`
7. `request_wallet_charge`
8. if policy returns `pending_approval`, the normal path is to approve it in the desktop app `Requests` tab
9. if you want to do that from chat instead, use:
   - `list_wallet_requests`
   - `respond_wallet_request`

`request_wallet_charge` takes:

- `walletAccountId`
- `merchant`
- `amountUsd`
- optional `memo`
- optional `bookingReference`
- optional `paymentMethodId`

If the request is within policy and a card is linked, Countersign runs the wallet-side charge immediately.
If the request is above the approval threshold, it stays pending until the wallet owner approves it in the desktop app or explicitly tells Claude to approve it.

## Local State

By default the MCP server uses:

- `data/store.json`
- `local-wallet/`

You can override those with:

- `COUNTERSIGN_DATA_FILE`
- `COUNTERSIGN_WALLET_DIR`

If you want the MCP server to use a local trusted-agent registry for tests or demos, set:

- `COUNTERSIGN_TRUSTED_AGENTS_JSON`

Example:

```bash
export COUNTERSIGN_DATA_FILE=/tmp/countersign/store.json
export COUNTERSIGN_WALLET_DIR=/tmp/countersign/local-wallet
```

## Claude Code Config

For Claude Code, add this to your project-level `.mcp.json`:

```json
{
  "mcpServers": {
    "countersign": {
      "command": "npm",
      "args": ["run", "mcp:start"],
      "cwd": "/path/to/agent_wallet"
    }
  }
}
```

## Claude Desktop Config

Claude Desktop does not load your shell profile, so tools installed via version managers (nvm, fnm, etc.) are not on its PATH. You need to use full paths.

1. Find your node binary:

   ```bash
   which node
   # e.g. /Users/you/.nvm/versions/node/v24.11.1/bin/node
   ```

2. Open the Claude Desktop config file:

   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

3. Add the countersign server to the `mcpServers` object. For this repo on your machine, use:

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

4. Restart Claude Desktop. The server should appear in **Settings > Developer** with a green status.

## Notes

This MCP server is now the primary local wallet surface for Claude. The travel agent still uses the Countersign SDK for remote authorization requests, while Claude uses MCP to act on behalf of the wallet owner locally.

In the current travel-agent wedge, you do not need a preloaded wallet balance if the local wallet daemon has a linked payment method. In that mode, the wallet owner approves the request in the app or through Claude, and the wallet runs the Stripe charge locally on behalf of the travel agent.
