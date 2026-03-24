# @tongateway/mcp

[![smithery badge](https://smithery.ai/badge/tongateway/agent)](https://smithery.ai/servers/tongateway/agent)

MCP server for [Agent Gateway](https://tongateway.ai) — gives AI agents full access to the TON blockchain via Model Context Protocol.

**16 tools:** wallet info, jettons, NFTs, transactions, transfers, .ton DNS, prices, DEX orders, agent wallets, and more.

## Quick Start

### Claude Code

```bash
claude mcp add-json tongateway '{
  "command": "npx",
  "args": ["-y", "@tongateway/mcp"],
  "env": {
    "AGENT_GATEWAY_API_URL": "https://api.tongateway.ai"
  }
}' --scope user
```

### Cursor

Add to Cursor Settings → MCP Servers:

```json
{
  "mcpServers": {
    "tongateway": {
      "command": "npx",
      "args": ["-y", "@tongateway/mcp"],
      "env": {
        "AGENT_GATEWAY_API_URL": "https://api.tongateway.ai"
      }
    }
  }
}
```

### OpenClaw

```bash
openclaw config set --strict-json plugins.entries.acpx.config.mcpServers '{
  "tongateway": {
    "command": "npx",
    "args": ["-y", "@tongateway/mcp"],
    "env": {
      "AGENT_GATEWAY_API_URL": "https://api.tongateway.ai"
    }
  }
}'
```

No token needed upfront — the agent authenticates via `request_auth` (generates a one-time link, user connects wallet). Token persists in `~/.tongateway/token` across restarts.

## Tools

### Auth

| Tool | Description |
|------|-------------|
| `request_auth` | Generate a one-time link for wallet connection |
| `get_auth_token` | Retrieve token after user connects wallet |

### Wallet

| Tool | Description |
|------|-------------|
| `get_wallet_info` | Wallet address, TON balance, account status |
| `get_jetton_balances` | All token balances (USDT, NOT, DOGS, etc.) |
| `get_transactions` | Recent transaction history |
| `get_nft_items` | NFTs owned by the wallet |

### Transfers (Safe — requires wallet approval)

| Tool | Description |
|------|-------------|
| `request_transfer` | Request a TON transfer (to, amountNano, payload?, stateInit?) |
| `get_request_status` | Check transfer status by ID |
| `list_pending_requests` | List all pending requests |

### Lookup

| Tool | Description |
|------|-------------|
| `resolve_name` | Resolve .ton domain to address |
| `get_ton_price` | Current TON price in USD/EUR |

### Agent Wallet (Autonomous — no approval needed)

| Tool | Description |
|------|-------------|
| `deploy_agent_wallet` | Deploy a dedicated wallet contract for the agent |
| `execute_agent_wallet_transfer` | Send TON directly from agent wallet |
| `get_agent_wallet_info` | Balance, seqno, agent key status |

## How it works

```
You: "Send 1 TON to alice.ton"

Agent: resolve_name("alice.ton") → 0:83df...
       request_transfer(to="0:83df...", amountNano="1000000000")
       → Transfer request created. Approve in your wallet app.
```

For agent wallets (autonomous mode):

```
You: "Send 0.5 TON from my agent wallet to 0:abc..."

Agent: execute_agent_wallet_transfer(wallet, to, amount)
       → Transfer executed. No approval needed.
```

## Links

- [tongateway.ai](https://tongateway.ai) — landing page + install guides
- [Dashboard](https://tongateway.ai/app.html) — connect wallet & manage tokens
- [API Docs](https://api.tongateway.ai/docs) — Swagger UI
- [Agent Wallet Contract](https://github.com/tongateway/ton-agent-gateway-contract) — FunC smart contract
- [Skill File](https://tongateway.ai/agent-gateway.md) — context file for AI agents
- [Smithery](https://smithery.ai/servers/tongateway/agent) — MCP marketplace listing
- [MCP HTTP Endpoint](https://tongateway.run.tools) — remote MCP transport

## License

MIT
