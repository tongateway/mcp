---
name: agent-gateway
description: Agent Gateway — 16 tools for TON blockchain. Wallet info, transfers, jettons, NFTs, .ton DNS, prices, DEX orders, and autonomous agent wallets. Package: @tongateway/mcp
---

# Agent Gateway

Agent Gateway gives you 16 tools to interact with TON blockchain. Check balances, view tokens/NFTs, send transfers, resolve .ton names, place DEX orders, and deploy autonomous agent wallets.

**MCP package:** `@tongateway/mcp` (install via `npx -y @tongateway/mcp`)

## Authentication

If you get "No token configured" errors, authenticate first:

1. Call `request_auth` — you'll get a one-time link
2. Ask the user to open the link and connect their wallet
3. Call `get_auth_token` with the authId — you'll get a token
4. All other tools now work. Token persists across restarts.

## Tools

### Wallet

| Tool | Params | Description |
|------|--------|-------------|
| `get_wallet_info` | — | Wallet address, TON balance, account status |
| `get_jetton_balances` | — | All token balances (USDT, NOT, DOGS, etc.) |
| `get_transactions` | `limit?` (number) | Recent transaction history |
| `get_nft_items` | — | NFTs owned by the wallet |

### Transfers (Safe — requires wallet approval)

| Tool | Params | Description |
|------|--------|-------------|
| `request_transfer` | `to`, `amountNano`, `payload?`, `stateInit?` | Queue a TON transfer for owner approval |
| `get_request_status` | `id` | Check status: pending, confirmed, rejected, expired |
| `list_pending_requests` | — | List all pending transfer requests |

### Lookup

| Tool | Params | Description |
|------|--------|-------------|
| `resolve_name` | `domain` | Resolve .ton domain to address. ALWAYS use before transfer when user gives a .ton name |
| `get_ton_price` | `currencies?` | TON price in USD/EUR/etc. |

### DEX (open4dev order book)

| Tool | Params | Description |
|------|--------|-------------|
| `create_dex_order` | `fromToken`, `toToken`, `amount`, `priceRateNano` | Place a limit order on the DEX |
| `list_dex_pairs` | — | List available trading pairs |

### Agent Wallet (Autonomous — NO approval needed)

| Tool | Params | Description |
|------|--------|-------------|
| `deploy_agent_wallet` | — | Deploy a dedicated wallet contract. WARNING: agent can spend funds without approval |
| `execute_agent_wallet_transfer` | `walletAddress`, `to`, `amountNano` | Send TON directly from agent wallet |
| `get_agent_wallet_info` | `walletAddress?` | Balance, seqno, status. Omit address to list all |

### Auth

| Tool | Params | Description |
|------|--------|-------------|
| `request_auth` | `label?` | Generate a one-time auth link |
| `get_auth_token` | `authId` | Retrieve token after user connects wallet |

## Amount conversion

Amounts are in **nanoTON**: 1 TON = 1,000,000,000 nanoTON

| TON | nanoTON |
|-----|---------|
| 0.1 | 100000000 |
| 0.5 | 500000000 |
| 1 | 1000000000 |
| 10 | 10000000000 |

## Usage examples

### Check wallet and tokens

```
get_wallet_info()
→ Address: 0:9d43...0c02, Balance: 823.18 TON, Status: active

get_jetton_balances()
→ USDT: 107.79, NOT: 3,186,370.60, BUILD: 45,277.57
```

### Send TON to .ton domain

```
resolve_name({ domain: "alice.ton" })
→ alice.ton → 0:83df...31a8

request_transfer({ to: "0:83df...31a8", amountNano: "500000000" })
→ Transfer request created. Approve in your wallet app.
```

### Place a DEX order

```
create_dex_order({ fromToken: "NOT", toToken: "TON", amount: "10000000000", priceRateNano: "..." })
→ Order placed on open4dev DEX. Approve in your wallet app.
```

### Autonomous transfer (no approval)

```
deploy_agent_wallet()
→ Agent Wallet deployed at EQCT1...

execute_agent_wallet_transfer({ walletAddress: "EQCT1...", to: "0:abc...", amountNano: "500000000" })
→ Transfer executed. No approval needed.
```

## Important

- **Safe mode (default):** You request transfers, the wallet owner approves on their phone
- **Autonomous mode:** Agent wallet — agent signs directly, no approval. Only use when user explicitly asks
- **Requests expire in 5 minutes** if not approved
- **Always use `resolve_name`** when the user gives a .ton domain
- **Token persists** in `~/.tongateway/token` across restarts

## Links

- Website: https://tongateway.ai
- API docs: https://api.tongateway.ai/docs
- MCP package: https://www.npmjs.com/package/@tongateway/mcp
- GitHub: https://github.com/tongateway/mcp
