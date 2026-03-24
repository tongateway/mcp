---
name: agent-gateway
description: Agent Gateway — TON blockchain tools for AI agents. Wallet info, transfers (with owner approval), jettons, NFTs, .ton DNS resolution, token prices, and DEX orders. All transactions require human approval via TON Connect.
---

# Agent Gateway

Agent Gateway gives your AI agent read and write access to the TON blockchain. All write operations (transfers, DEX orders) require explicit approval from the wallet owner via TON Connect — the agent cannot move funds on its own.

**MCP package:** `@tongateway/mcp`

## Setup

```bash
claude mcp add-json tongateway '{"command":"npx","args":["-y","@tongateway/mcp"],"env":{"AGENT_GATEWAY_API_URL":"https://api.tongateway.ai"}}' --scope user
```

Or build from source: `git clone https://github.com/tongateway/mcp && cd mcp && npm install && npm run build`

## Authentication

1. Call `auth.request` — returns a one-time link
2. Show the link to the user — they open it and connect their wallet
3. Call `auth.get_token` with the authId — token is saved automatically

## Tools

### Wallet (read-only)

| Tool | Params | Description |
|------|--------|-------------|
| `wallet.info` | — | Wallet address, TON balance, account status |
| `wallet.jettons` | — | All token balances (USDT, NOT, DOGS, etc.) |
| `wallet.transactions` | `limit?` | Recent transaction history |
| `wallet.nfts` | — | NFTs owned by the wallet |

### Transfers (requires wallet owner approval)

| Tool | Params | Description |
|------|--------|-------------|
| `transfer.request` | `to`, `amountNano` | Request a TON transfer — owner approves on phone |
| `transfer.status` | `id` | Check status: pending, confirmed, rejected, expired |
| `transfer.pending` | — | List pending transfer requests |

### Lookup (read-only)

| Tool | Params | Description |
|------|--------|-------------|
| `lookup.resolve_name` | `domain` | Resolve .ton domain to address |
| `lookup.price` | `currencies?` | TON price in USD/EUR |

### DEX Orders (requires wallet owner approval)

| Tool | Params | Description |
|------|--------|-------------|
| `dex.create_order` | `fromToken`, `toToken`, `amount`, `price` | Place a limit order — owner approves on phone |
| `dex.pairs` | — | List available trading pairs |

### Auth

| Tool | Params | Description |
|------|--------|-------------|
| `auth.request` | `label?` | Generate a one-time auth link |
| `auth.get_token` | `authId` | Complete authentication |

## Amount Reference

1 TON = 1,000,000,000 nanoTON

| TON | nanoTON |
|-----|---------|
| 0.1 | 100000000 |
| 0.5 | 500000000 |
| 1 | 1000000000 |
| 10 | 10000000000 |

## Examples

### Check balance
```
wallet.info() → Balance: 823.18 TON, Status: active
```

### Send TON
```
lookup.resolve_name({ domain: "alice.ton" }) → 0:83df...31a8
transfer.request({ to: "0:83df...31a8", amountNano: "500000000" }) → Approve in wallet
```

### DEX order
```
dex.create_order({ fromToken: "NOT", toToken: "TON", amount: "10000", price: 0.000289 }) → Approve in wallet
```

## Security

- **All transfers require human approval** — the agent cannot spend funds without the wallet owner signing
- **No private keys** — only a session token (JWT) is stored, revocable from the dashboard
- **Open source** — all code is public: https://github.com/tongateway/mcp

## Links

- https://tongateway.ai — website
- https://api.tongateway.ai/docs — API reference
- https://github.com/tongateway/mcp — source code
