# Countersign MCP Server

Countersign ships with a local MCP server so Claude can perform wallet actions against the same local Countersign state.

Run it from the repo root:

```bash
npm run mcp:start
```

## What It Can Do

The MCP server exposes these tools:

- `create_wallet`
- `get_wallet`
- `fund_wallet`
- `set_wallet_policy`
- `generate_claim_token`
- `install_wallet_daemon`
- `claim_wallet_daemon`
- `list_pending_wallet_requests`
- `review_wallet_request`

This means Claude can:

- create and fund a wallet
- set spending policy
- install a local wallet daemon identity
- claim that daemon to a wallet account
- inspect pending travel-agent authorization requests
- approve or reject those requests

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

## Claude Config

Example MCP config:

```json
{
  "mcpServers": {
    "countersign": {
      "command": "npm",
      "args": ["run", "mcp:start"],
      "cwd": "/Users/christycui/Documents/agent_wallet"
    }
  }
}
```

## Notes

This MCP server is local-control-plane oriented. It does not replace the travel-agent SDK. The travel agent still uses the Countersign SDK for remote authorization requests, while Claude uses MCP to act on behalf of the wallet owner locally.
