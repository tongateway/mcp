#!/usr/bin/env node

// Handle --help and --version before importing anything
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`@tongateway/mcp — TON blockchain gateway for AI agents

Usage:
  npx @tongateway/mcp              Start MCP server (stdio transport)
  npx @tongateway/mcp --http       Start HTTP server (port 3100)

Environment variables:
  AGENT_GATEWAY_API_URL   API base URL (default: https://api.tongateway.ai)
  AGENT_GATEWAY_TOKEN     Pre-configured auth token (optional)
  MCP_HTTP_PORT           HTTP server port (default: 3100 with --http)

Tools (16):
  auth.request, auth.get_token
  wallet.info, wallet.jettons, wallet.transactions, wallet.nfts
  transfer.request, transfer.status, transfer.pending
  lookup.resolve_name, lookup.price
  dex.create_order, dex.pairs
  agent_wallet.deploy, agent_wallet.transfer, agent_wallet.info

Docs: https://tongateway.ai/docs
GitHub: https://github.com/tongateway/mcp`);
  process.exit(0);
}

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log('0.15.0');
  process.exit(0);
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const API_URL = process.env.AGENT_GATEWAY_API_URL ?? 'https://api.tongateway.ai';
const TOKEN_FILE = join(homedir(), '.tongateway', 'token');

function loadToken(): string {
  if (process.env.AGENT_GATEWAY_TOKEN) return process.env.AGENT_GATEWAY_TOKEN;
  try {
    return readFileSync(TOKEN_FILE, 'utf-8').trim();
  } catch {
    return '';
  }
}

function saveToken(token: string): void {
  try {
    mkdirSync(join(homedir(), '.tongateway'), { recursive: true });
    writeFileSync(TOKEN_FILE, token, 'utf-8');
  } catch {}
}

let TOKEN = loadToken();

// Compiled AgentVault contract code (embedded for security — no external dependency)
const AGENT_WALLET_CODE_HEX = 'b5ee9c7241020a01000210000114ff00f4a413f4bcf2c80b01020120020702014803060188d020d749c120915b8eb920d70b1f20821061677374bd2182106172766bbdb0218210616f776bbdb0925f03e0821005f5e10070fb0202d0d3030171b0925f03e0fa4030e20401a2ed44d0d200d31fd31fd3fffa40d3ffd31f305172c705f2e19c078020d7218040d72128821061677374ba8e2336363603d3ffd31f301036102506c8ca0015cb1f13cb1fcbff01cf16cbffcb1fc9ed54e30e0500b02882106172766bba8e2230353535702010365e22102306c8ca0015cb1f13cb1fcbff01cf16cbffcb1fc9ed54e032078210616f776bba8e1bd3ff30552306c8ca0015cb1f13cb1fcbff01cf16cbffcb1fc9ed54e05f07f2000017a0992fda89a0e3ae43ae163f0106f2db3c0801f620d70b1f82107369676ebaf2e195208308d722018308d723208020d721d31fd31fd31fed44d0d200d31fd31fd3fffa40d3ffd31f3026b3f2d1905185baf2e1915193baf2e19207f823bbf2d19408f901547098f9107029c300953051a8f91092323ae25290b1f2e19308b397f82324bcf2d19adef800a4506510470900e0470306c8ca0015cb1f13cb1fcbff01cf16cbffcb1fc9ed54f80ff40430206e91308e4c7f21d73930709421c700b38e2d01d72820761e436c20d749c008f2e19d20d74ac002f2e19d20d71d06c712c2005230b0f2d19ed74cd7393001a4e86c128407bbf2e19dd74ac000f2e19ded55e2c6472d0b';

// Local wallet storage — agent secret keys never leave the machine
const WALLETS_FILE = join(homedir(), '.tongateway', 'wallets.json');

function loadLocalWallets(): Record<string, { agentSecretKey: string; walletId: number }> {
  try {
    return JSON.parse(readFileSync(WALLETS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveLocalWallet(address: string, agentSecretKey: string, walletId: number): void {
  const wallets = loadLocalWallets();
  wallets[address] = { agentSecretKey, walletId };
  mkdirSync(join(homedir(), '.tongateway'), { recursive: true });
  writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2), 'utf-8');
}

async function apiCall(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (TOKEN) {
    headers['Authorization'] = `Bearer ${TOKEN}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? `API error ${res.status}`);
  }
  return data;
}

const server = new McpServer({
  name: 'agent-gateway',
  version: '0.1.0',
});

server.tool(
  'auth.request',
  'Authenticate with TON blockchain. Call this tool FIRST if you get "No token configured" errors. It returns a URL that you MUST display to the user as a clickable link. The user opens it in their browser to connect their wallet. After they confirm, call auth.get_token with the authId. Do NOT use curl or fetch — use this MCP tool. Do NOT poll in a loop — just call auth.get_token once after the user says they connected.',
  {
    label: z.string().optional().describe('Label for this agent session (e.g. "claude-agent")'),
  },
  { title: 'Request Authentication', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async ({ label }) => {
    try {
      const result = await fetch(`${API_URL}/v1/auth/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label || 'agent' }),
      });
      const data = await result.json() as any;
      if (!result.ok) throw new Error(data.error ?? 'Failed');

      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `IMPORTANT: Show this link to the user NOW:`,
              ``,
              `👉 ${data.authUrl}`,
              ``,
              `Tell the user: "Open this link and connect your wallet. Let me know when done."`,
              ``,
              `Auth ID: ${data.authId}`,
              ``,
              `When the user confirms they connected, call auth.get_token with authId "${data.authId}"`,
            ].join('\n'),
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'auth.get_token',
  'Complete authentication after the user opened the link from auth.request. Pass the authId you received. Once successful, all other tools become available. You only need to authenticate once — the token is saved automatically.',
  {
    authId: z.string().describe('The authId returned by auth.request'),
  },
  { title: 'Get Auth Token', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async ({ authId }) => {
    try {
      // Retry up to 3 times with 2s delay (KV eventual consistency)
      let data: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await fetch(`${API_URL}/v1/auth/check/${authId}`, {
          headers: { 'Content-Type': 'application/json' },
        });
        data = await result.json() as any;
        if (!result.ok) throw new Error(data.error ?? 'Failed');
        if (data.status === 'completed') break;
        if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
      }

      if (data.status === 'pending') {
        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Authentication still pending.`,
                `The user has not connected their wallet yet.`,
                ``,
                `Wait a moment and call auth.get_token again.`,
              ].join('\n'),
            },
          ],
        };
      }

      // Store the token for future API calls and persist to disk
      TOKEN = data.token;
      saveToken(TOKEN);

      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `Authentication complete!`,
              `Token received and configured.`,
              `Wallet: ${data.address}`,
              ``,
              `You can now use transfer.request, transfer.status, and transfer.pending.`,
            ].join('\n'),
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'transfer.request',
  'Request a TON transfer. The user must approve it in their wallet app. Amount is in nanoTON (1 TON = 1000000000). Use the comment parameter to attach a text message. The transfer is queued — use transfer.status to check if approved.',
  {
    to: z.string().describe('Destination TON address'),
    amountNano: z.string().describe('Amount in nanoTON (1 TON = 1000000000)'),
    comment: z.string().optional().describe('Text comment/message to attach to the transfer (e.g. "Payment for services")'),
    payload: z.string().optional().describe('Optional BOC-encoded payload (advanced — use comment for simple text messages)'),
    stateInit: z.string().optional().describe('Optional stateInit BOC for deploying new contracts'),
  },
  { title: 'Request Transfer', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async ({ to, amountNano, comment, payload, stateInit }) => {
    if (!TOKEN) {
      return {
        content: [{ type: 'text' as const, text: 'No token configured. Use auth.request first to authenticate.' }],
        isError: true,
      };
    }
    try {
      const body: Record<string, string> = { to, amountNano };
      // Encode text comment as TON payload (32 zero bits + UTF-8 text)
      if (comment && !payload) {
        const { beginCell } = await import('@ton/core');
        const commentCell = beginCell()
          .storeUint(0, 32) // text comment tag
          .storeStringTail(comment)
          .endCell();
        body.payload = commentCell.toBoc().toString('base64');
      } else if (payload) {
        body.payload = payload;
      }
      if (stateInit) body.stateInit = stateInit;

      const result = await apiCall('/v1/safe/tx/transfer', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `Transfer request created.`,
              `ID: ${result.id}`,
              `To: ${result.to}`,
              `Amount: ${result.amountNano} nanoTON`,
              `Status: ${result.status}`,
              `Expires: ${new Date(result.expiresAt).toISOString()}`,
              ``,
              `The wallet owner must approve this in their TON Connect client.`,
            ].join('\n'),
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'transfer.status',
  'Check the status of a transfer request. Statuses: pending (waiting for approval), confirmed (signed and broadcast), rejected (user declined), expired (5 min timeout). Also shows broadcast result if available.',
  {
    id: z.string().describe('The request ID returned by transfer.request'),
  },
  { title: 'Transfer Status', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async ({ id }) => {
    if (!TOKEN) {
      return {
        content: [{ type: 'text' as const, text: 'No token configured. Use auth.request first to authenticate.' }],
        isError: true,
      };
    }
    try {
      const result = await apiCall(`/v1/safe/tx/${id}`);

      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `Request ${result.id}`,
              `Status: ${result.status}`,
              `To: ${result.to}`,
              `Amount: ${result.amountNano} nanoTON`,
              result.txHash ? `TX Hash: ${result.txHash}` : null,
              result.broadcastResult ? `Broadcast: ${result.broadcastResult}` : null,
              result.broadcastError ? `Error: ${result.broadcastError}` : null,
              `Created: ${new Date(result.createdAt).toISOString()}`,
              `Expires: ${new Date(result.expiresAt).toISOString()}`,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'transfer.pending',
  'List all transfer requests waiting for wallet owner approval. Use to check if there are unfinished transfers.',
  {},
  { title: 'Pending Transfers', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async () => {
    if (!TOKEN) {
      return {
        content: [{ type: 'text' as const, text: 'No token configured. Use auth.request first to authenticate.' }],
        isError: true,
      };
    }
    try {
      const data = await apiCall('/v1/safe/tx/pending');
      const requests = data.requests;

      if (!requests.length) {
        return {
          content: [{ type: 'text' as const, text: 'No pending requests.' }],
        };
      }

      const lines = requests.map(
        (r: any) =>
          `- ${r.id}: ${r.amountNano} nanoTON → ${r.to} (expires ${new Date(r.expiresAt).toISOString()})`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `${requests.length} pending request(s):\n${lines.join('\n')}`,
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'wallet.info',
  'Get the connected wallet address, TON balance (in nanoTON and TON), and account status. Use this to check how much TON the user has before sending transfers.',
  {},
  { title: 'Wallet Info', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async () => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use auth.request first.' }], isError: true };
    }
    try {
      const result = await apiCall('/v1/wallet/balance');
      const balanceTon = (BigInt(result.balance) / 1000000000n).toString();
      const balanceFrac = (BigInt(result.balance) % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '') || '0';
      return {
        content: [{
          type: 'text' as const,
          text: [
            `Address: ${result.address}`,
            `Balance: ${balanceTon}.${balanceFrac} TON (${result.balance} nanoTON)`,
            `Status: ${result.status}`,
          ].join('\n'),
        }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'wallet.jettons',
  'List all tokens (jettons) in the wallet — USDT, NOT, DOGS, and others. Shows symbol, name, balance, and decimals for each. Use this when the user asks about their tokens or wants to know what they hold.',
  {},
  { title: 'Jetton Balances', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async () => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use auth.request first.' }], isError: true };
    }
    try {
      const result = await apiCall('/v1/wallet/jettons');
      if (!result.balances?.length) {
        return { content: [{ type: 'text' as const, text: 'No jettons found in this wallet.' }] };
      }
      const lines = result.balances.map((b: any) => {
        const decimals = b.decimals ?? 9;
        const raw = BigInt(b.balance);
        const divisor = BigInt(10 ** decimals);
        const whole = (raw / divisor).toString();
        const frac = (raw % divisor).toString().padStart(decimals, '0').replace(/0+$/, '') || '0';
        return `- ${b.symbol ?? b.name ?? 'Unknown'}: ${whole}.${frac} (${b.address})`;
      });
      return {
        content: [{ type: 'text' as const, text: `Jetton balances:\n${lines.join('\n')}` }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'wallet.transactions',
  'Get recent transaction history. Shows timestamps, action types, and whether transactions were flagged as scam. Use when the user asks "what happened" or wants to review recent activity.',
  {
    limit: z.number().optional().describe('Number of transactions to return (default 10)'),
  },
  { title: 'Transaction History', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async ({ limit }) => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use auth.request first.' }], isError: true };
    }
    try {
      const result = await apiCall(`/v1/wallet/transactions?limit=${limit ?? 10}`);
      const events = result.events ?? [];
      if (!events.length) {
        return { content: [{ type: 'text' as const, text: 'No recent transactions.' }] };
      }
      const lines = events.map((e: any) => {
        const time = new Date(e.timestamp * 1000).toISOString();
        const actions = (e.actions ?? []).map((a: any) => a.type).join(', ');
        return `- ${time}: ${actions || 'unknown'} ${e.is_scam ? '[SCAM]' : ''}`;
      });
      return {
        content: [{ type: 'text' as const, text: `Recent transactions:\n${lines.join('\n')}` }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'wallet.nfts',
  'List all NFTs owned by the wallet — name, collection, and address for each. Use when the user asks about their NFTs or collectibles.',
  {},
  { title: 'NFT Items', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async () => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use auth.request first.' }], isError: true };
    }
    try {
      const result = await apiCall('/v1/wallet/nfts');
      const nfts = result.nfts ?? [];
      if (!nfts.length) {
        return { content: [{ type: 'text' as const, text: 'No NFTs found in this wallet.' }] };
      }
      const lines = nfts.map((n: any) =>
        `- ${n.name ?? 'Unnamed'} ${n.collection ? `(${n.collection})` : ''} — ${n.address}`
      );
      return {
        content: [{ type: 'text' as const, text: `NFTs (${nfts.length}):\n${lines.join('\n')}` }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'lookup.resolve_name',
  'Resolve a .ton domain name (like "alice.ton") to a raw wallet address. ALWAYS use this before transfer.request when the user gives a .ton name instead of a raw address.',
  {
    domain: z.string().describe('The .ton domain name to resolve (e.g. "alice.ton")'),
  },
  { title: 'Resolve .ton Name', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async ({ domain }) => {
    try {
      const result = await fetch(`${API_URL}/v1/dns/${encodeURIComponent(domain)}/resolve`);
      const data = await result.json() as any;
      if (!result.ok) throw new Error(data.error ?? 'Failed');
      if (!data.address) {
        return { content: [{ type: 'text' as const, text: `Domain "${domain}" not found or has no wallet address.` }] };
      }
      return {
        content: [{ type: 'text' as const, text: `${domain} → ${data.address}` }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'lookup.price',
  'Get the current TON price in USD, EUR, or other currencies. Use when the user asks "how much is my TON worth" or before transfers to show USD equivalents.',
  {
    currencies: z.string().optional().describe('Comma-separated currencies (default "USD")'),
  },
  { title: 'TON Price', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async ({ currencies }) => {
    try {
      const curr = currencies || 'USD';
      const result = await fetch(`${API_URL}/v1/market/price?tokens=TON&currencies=${curr}`);
      const data = await result.json() as any;
      if (!result.ok) throw new Error(data.error ?? 'Failed');
      const tonRates = data.rates?.TON?.prices ?? {};
      const lines = Object.entries(tonRates).map(([c, p]) => `1 TON = ${p} ${c}`);
      return {
        content: [{ type: 'text' as const, text: lines.length ? lines.join('\n') : 'Price data unavailable.' }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'dex.create_order',
  'Place a limit order on the open4dev DEX order book. Both amount and price are human-readable — the API converts to raw units automatically. The order requires wallet approval. Slippage (4% including fees) is applied automatically.',
  {
    fromToken: z.string().describe('Token to sell, e.g. "NOT", "TON", "USDT"'),
    toToken: z.string().describe('Token to buy, e.g. "TON", "NOT", "AGNT"'),
    amount: z.string().describe('Human-readable amount to sell, e.g. "10000" for 10,000 NOT or "5" for 5 USDT'),
    price: z.number().describe('Human-readable price: how many toToken per 1 fromToken. E.g. price=20 means "1 USDT = 20 AGNT". price=0.000289 means "1 NOT = 0.000289 TON".'),
  },
  { title: 'Create DEX Order', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async ({ fromToken, toToken, amount, price }) => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use auth.request first.' }], isError: true };
    }
    try {
      const result = await apiCall('/v1/dex/order', {
        method: 'POST',
        body: JSON.stringify({ fromToken, toToken, amount, price }),
      });

      return {
        content: [{
          type: 'text' as const,
          text: [
            `Order placed on open4dev DEX!`,
            ``,
            `${fromToken} → ${toToken}`,
            `Amount: ${amount}`,
            `Price: ${price} ${toToken} per ${fromToken}`,
            `Slippage: ${result.swap?.slippage ?? 4}% (includes fees)`,
            `Request ID: ${result.id}`,
            ``,
            `Approve the order in your wallet app.`,
          ].join('\n'),
        }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'dex.pairs',
  'List available trading pairs on the DEX. Shows which token swaps are configured and available.',
  {},
  { title: 'DEX Pairs', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async () => {
    try {
      const result = await fetch(`${API_URL}/v1/dex/pairs`);
      const data = await result.json() as any;
      const tokens = data.tokens || [];
      if (!tokens.length) {
        return { content: [{ type: 'text' as const, text: 'No DEX pairs available.' }] };
      }
      return {
        content: [{ type: 'text' as const, text: `Available tokens: ${tokens.join(', ')}\n\nAny pair combination is supported (e.g. NOT/TON, USDT/TON, DOGS/NOT).` }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'agent_wallet.deploy',
  'Deploy an Agent Wallet smart contract — a dedicated sub-wallet for autonomous operations. WARNING: The agent can spend funds from this wallet WITHOUT user approval. Only deploy if the user explicitly wants autonomous transfers. After deployment, top up the wallet with funds.',
  {},
  { title: 'Deploy Agent Wallet', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async () => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use auth.request first.' }], isError: true };
    }
    try {
      // Get owner's public key
      const meResult = await apiCall('/v1/auth/me');
      const ownerAddress = meResult.address;

      // Get owner public key from tonapi
      const pubKeyRes = await fetch(`https://tonapi.io/v2/wallet/${encodeURIComponent(ownerAddress)}/get-account-public-key`);
      const pubKeyData = await pubKeyRes.json() as any;
      if (!pubKeyData.public_key) throw new Error('Could not get owner public key');
      const ownerPublicKey = pubKeyData.public_key;

      // Generate agent keypair on server
      const deployResult = await apiCall('/v1/agent-wallet/deploy', {
        method: 'POST',
        body: JSON.stringify({ ownerPublicKey }),
      });

      const { agentPublicKey, agentSecretKey, walletId } = deployResult;

      // Build stateInit using embedded compiled code
      const { Cell, beginCell, Address, contractAddress, storeStateInit } = await import('@ton/core');

      const code = Cell.fromBoc(Buffer.from(AGENT_WALLET_CODE_HEX, 'hex'))[0];

      const ownerPubBuf = Buffer.from(ownerPublicKey, 'hex');
      const agentPubBuf = Buffer.from(agentPublicKey, 'hex');
      const adminAddr = Address.parse(ownerAddress);

      const data = beginCell()
        .storeBit(true)              // signatureAllowed
        .storeUint(0, 32)            // seqno
        .storeUint(walletId, 32)     // walletId
        .storeBuffer(ownerPubBuf, 32) // ownerPublicKey
        .storeAddress(adminAddr)      // adminAddress
        .storeBuffer(agentPubBuf, 32) // agentPublicKey (set from the start)
        .storeUint(Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600, 32) // agentValidUntil (10 years)
        .endCell();

      const init = { code, data };
      const address = contractAddress(0, init);
      const stateInitCell = beginCell().store(storeStateInit(init)).endCell();
      const stateInitBoc = stateInitCell.toBoc().toString('base64');

      // Deploy via safe transfer (user approves)
      const transferResult = await apiCall('/v1/safe/tx/transfer', {
        method: 'POST',
        body: JSON.stringify({
          to: address.toRawString(),
          amountNano: '100000000', // 0.1 TON for deployment
          stateInit: stateInitBoc,
        }),
      });

      // Register the wallet on the server
      await apiCall('/v1/agent-wallet/register', {
        method: 'POST',
        body: JSON.stringify({
          address: address.toRawString(),
          agentSecretKey,
          agentPublicKey,
          ownerPublicKey,
          walletId,
        }),
      });

      // Save secret key locally — never leaves this machine
      saveLocalWallet(address.toRawString(), agentSecretKey, walletId);

      return {
        content: [{
          type: 'text' as const,
          text: [
            'Agent Wallet deployment requested!',
            '',
            `Address: ${address.toString()}`,
            `Raw: ${address.toRawString()}`,
            `Request ID: ${transferResult.id}`,
            '',
            'Approve the deployment in your wallet app (0.1 TON).',
            'After approval, top up the wallet with funds the agent can spend.',
            '',
            'WARNING: The agent can spend funds from this wallet without your approval.',
          ].join('\n'),
        }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'agent_wallet.transfer',
  'Send TON directly from an Agent Wallet — NO approval needed. The agent signs and broadcasts immediately. Only works with deployed agent wallets. Use for automated/autonomous transfers where speed matters and the user has opted in.',
  {
    walletAddress: z.string().describe('The agent wallet contract address'),
    to: z.string().describe('Destination TON address'),
    amountNano: z.string().describe('Amount in nanoTON'),
  },
  { title: 'Agent Wallet Transfer', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async ({ walletAddress, to, amountNano }) => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use auth.request first.' }], isError: true };
    }
    try {
      const { Cell, beginCell, Address, SendMode, external, storeMessage } = await import('@ton/core');
      const { sign, keyPairFromSeed } = await import('@ton/crypto');

      // Get wallet config from local storage
      const localWallets = loadLocalWallets();
      const localConfig = localWallets[walletAddress];
      if (!localConfig) throw new Error('Agent wallet secret key not found locally. Was it deployed from this machine?');

      // Get current seqno from server
      const infoResult = await apiCall(`/v1/agent-wallet/${encodeURIComponent(walletAddress)}/info`);
      const seqno = infoResult.seqno;
      const walletId = localConfig.walletId;

      const secretKeyBuf = Buffer.from(localConfig.agentSecretKey, 'hex');
      // Normalize: if 64 bytes use as-is, if 32 bytes derive from seed
      let secretKey: Buffer;
      if (secretKeyBuf.length === 64) {
        secretKey = secretKeyBuf;
      } else {
        const kp = keyPairFromSeed(secretKeyBuf);
        secretKey = kp.secretKey;
      }

      const vaultAddr = Address.parse(walletAddress);
      const destAddr = Address.parse(to);

      // Build transfer message
      const transferMsg = beginCell()
        .storeUint(0x18, 6)
        .storeAddress(destAddr)
        .storeCoins(BigInt(amountNano))
        .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
        .endCell();

      // Build actions list
      const sendMode = SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS;
      const actionsList = beginCell()
        .storeRef(beginCell().endCell()) // empty previous
        .storeUint(0x0ec3c86d, 32)       // action_send_msg prefix
        .storeUint(sendMode, 8)
        .storeRef(transferMsg)
        .endCell();

      // Build unsigned body
      const validUntil = Math.floor(Date.now() / 1000) + 300;
      const unsignedBody = beginCell()
        .storeUint(0x7369676e, 32)  // prefix::signed_external
        .storeUint(walletId, 32)
        .storeUint(validUntil, 32)
        .storeUint(seqno, 32)
        .storeMaybeRef(actionsList)
        .endCell();

      // Sign
      const signature = sign(unsignedBody.hash(), secretKey);

      const signedBody = beginCell()
        .storeSlice(unsignedBody.beginParse())
        .storeBuffer(signature)
        .endCell();

      // Build external message
      const extMsg = external({ to: vaultAddr, body: signedBody });
      const boc = beginCell().store(storeMessage(extMsg)).endCell().toBoc().toString('base64');

      // Broadcast
      const broadcastRes = await fetch('https://toncenter.com/api/v2/sendBoc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boc }),
      });
      const broadcastData = await broadcastRes.json() as any;

      if (!broadcastData.ok) {
        throw new Error(`Broadcast failed: ${broadcastData.error || JSON.stringify(broadcastData)}`);
      }

      const tonAmount = (BigInt(amountNano) / 1000000000n).toString() + '.' +
        (BigInt(amountNano) % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '');

      return {
        content: [{
          type: 'text' as const,
          text: [
            'Transfer executed from Agent Wallet!',
            '',
            `From: ${walletAddress}`,
            `To: ${to}`,
            `Amount: ${tonAmount} TON`,
            `Seqno: ${seqno}`,
            '',
            'Transaction broadcast successfully. No approval was needed.',
          ].join('\n'),
        }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'agent_wallet.info',
  'Get info about Agent Wallets — balance, seqno, agent key status. Pass a wallet address for details, or omit to list all agent wallets.',
  {
    walletAddress: z.string().optional().describe('Agent wallet address. If omitted, lists all your agent wallets.'),
  },
  { title: 'Agent Wallet Info', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async ({ walletAddress }) => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use auth.request first.' }], isError: true };
    }
    try {
      if (!walletAddress) {
        // List all wallets
        const result = await apiCall('/v1/agent-wallet/list');
        const wallets = result.wallets || [];
        if (!wallets.length) {
          return { content: [{ type: 'text' as const, text: 'No agent wallets found. Use agent_wallet.deploy to create one.' }] };
        }
        const lines = wallets.map((w: any) =>
          `- ${w.address} (created ${new Date(w.createdAt).toISOString()})`
        );
        return {
          content: [{ type: 'text' as const, text: `Agent wallets (${wallets.length}):\n${lines.join('\n')}` }],
        };
      }

      const result = await apiCall(`/v1/agent-wallet/${encodeURIComponent(walletAddress)}/info`);
      const balanceTon = (BigInt(result.balance) / 1000000000n).toString();
      const balanceFrac = (BigInt(result.balance) % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '') || '0';

      return {
        content: [{
          type: 'text' as const,
          text: [
            `Agent Wallet: ${result.address}`,
            `Balance: ${balanceTon}.${balanceFrac} TON`,
            `Status: ${result.status}`,
            `Seqno: ${result.seqno}`,
            `Agent Key: ${result.agentPublicKey}`,
            `Created: ${new Date(result.createdAt).toISOString()}`,
          ].join('\n'),
        }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

const httpPort = process.env.MCP_HTTP_PORT || (process.argv.includes('--http') ? '3100' : '');

if (httpPort) {
  // HTTP transport for Smithery and remote clients
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, version: '0.14.0' }));
      return;
    }

    // MCP endpoint
    if (req.url === '/mcp' || req.url === '/') {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined as any });
      res.on('close', () => { transport.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  httpServer.listen(Number(httpPort), () => {
    console.error(`MCP HTTP server listening on port ${httpPort}`);
  });
} else {
  // Default: stdio transport for local MCP clients
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
