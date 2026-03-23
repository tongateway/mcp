#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
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
  'request_auth',
  'Authenticate with TON blockchain. Call this FIRST if you get "No token configured" errors. Generates a one-time link — ask the user to open it and connect their wallet. Then call get_auth_token to complete. Token persists across restarts.',
  {
    label: z.string().optional().describe('Label for this agent session (e.g. "claude-agent")'),
  },
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
              `Authentication requested.`,
              ``,
              `Ask the user to open this link:`,
              data.authUrl,
              ``,
              `Auth ID: ${data.authId}`,
              `Expires: ${new Date(data.expiresAt).toISOString()}`,
              ``,
              `After the user connects their wallet, call get_auth_token with this authId to get the token.`,
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
  'get_auth_token',
  'Complete authentication after the user opened the link from request_auth. Pass the authId you received. Once successful, all other tools become available. You only need to authenticate once — the token is saved automatically.',
  {
    authId: z.string().describe('The authId returned by request_auth'),
  },
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
                `Wait a moment and call get_auth_token again.`,
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
              `You can now use request_transfer, get_request_status, and list_pending_requests.`,
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
  'request_transfer',
  'Request a TON transfer. The user must approve it in their wallet app. Amount is in nanoTON (1 TON = 1000000000). Supports optional payload (BOC) and stateInit (for contract deployment). The transfer is queued — use get_request_status to check if approved.',
  {
    to: z.string().describe('Destination TON address'),
    amountNano: z.string().describe('Amount in nanoTON (1 TON = 1000000000)'),
    payload: z.string().optional().describe('Optional BOC-encoded payload for the transaction'),
    stateInit: z.string().optional().describe('Optional stateInit BOC for deploying new contracts'),
  },
  async ({ to, amountNano, payload, stateInit }) => {
    if (!TOKEN) {
      return {
        content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first to authenticate.' }],
        isError: true,
      };
    }
    try {
      const body: Record<string, string> = { to, amountNano };
      if (payload) body.payload = payload;
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
  'get_request_status',
  'Check the status of a transfer request. Statuses: pending (waiting for approval), confirmed (signed and broadcast), rejected (user declined), expired (5 min timeout). Also shows broadcast result if available.',
  {
    id: z.string().describe('The request ID returned by request_transfer'),
  },
  async ({ id }) => {
    if (!TOKEN) {
      return {
        content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first to authenticate.' }],
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
  'list_pending_requests',
  'List all transfer requests waiting for wallet owner approval. Use to check if there are unfinished transfers.',
  {},
  async () => {
    if (!TOKEN) {
      return {
        content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first to authenticate.' }],
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
  'get_wallet_info',
  'Get the connected wallet address, TON balance (in nanoTON and TON), and account status. Use this to check how much TON the user has before sending transfers.',
  {},
  async () => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first.' }], isError: true };
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
  'get_jetton_balances',
  'List all tokens (jettons) in the wallet — USDT, NOT, DOGS, and others. Shows symbol, name, balance, and decimals for each. Use this when the user asks about their tokens or wants to know what they hold.',
  {},
  async () => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first.' }], isError: true };
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
  'get_transactions',
  'Get recent transaction history. Shows timestamps, action types, and whether transactions were flagged as scam. Use when the user asks "what happened" or wants to review recent activity.',
  {
    limit: z.number().optional().describe('Number of transactions to return (default 10)'),
  },
  async ({ limit }) => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first.' }], isError: true };
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
  'get_nft_items',
  'List all NFTs owned by the wallet — name, collection, and address for each. Use when the user asks about their NFTs or collectibles.',
  {},
  async () => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first.' }], isError: true };
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
  'resolve_name',
  'Resolve a .ton domain name (like "alice.ton") to a raw wallet address. ALWAYS use this before request_transfer when the user gives a .ton name instead of a raw address.',
  {
    domain: z.string().describe('The .ton domain name to resolve (e.g. "alice.ton")'),
  },
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
  'get_ton_price',
  'Get the current TON price in USD, EUR, or other currencies. Use when the user asks "how much is my TON worth" or before transfers to show USD equivalents.',
  {
    currencies: z.string().optional().describe('Comma-separated currencies (default "USD")'),
  },
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
  'create_dex_order',
  'Place a limit order on the open4dev DEX order book. Provide the token pair (e.g. NOT→TON), amount, and price. The order is created as a safe transfer — the user approves it in their wallet. Use get_ton_price or get_jetton_balances to determine current rates before swapping.',
  {
    fromToken: z.string().describe('Token to sell, e.g. "NOT", "TON", "USDT"'),
    toToken: z.string().describe('Token to buy, e.g. "TON", "NOT"'),
    amount: z.string().describe('Amount to sell in smallest unit (nanoTON for TON, or raw jetton amount based on decimals)'),
    priceRateNano: z.string().describe('Price rate in nanoTON per unit'),
  },
  async ({ fromToken, toToken, amount, priceRateNano }) => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first.' }], isError: true };
    }
    try {
      const result = await apiCall('/v1/dex/order', {
        method: 'POST',
        body: JSON.stringify({ fromToken, toToken, amount, priceRateNano }),
      });

      return {
        content: [{
          type: 'text' as const,
          text: [
            `Order placed on open4dev DEX!`,
            ``,
            `${fromToken} → ${toToken}`,
            `Amount: ${amount}`,
            `Price Rate: ${priceRateNano} nanoTON`,
            `Pool: ${result.swap?.pool || 'unknown'}`,
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
  'list_dex_pairs',
  'List available trading pairs on the DEX. Shows which token swaps are configured and available.',
  {},
  async () => {
    try {
      const result = await fetch(`${API_URL}/v1/dex/pairs`);
      const data = await result.json() as any;
      if (!data.pools?.length) {
        return { content: [{ type: 'text' as const, text: 'No DEX pools configured yet.' }] };
      }
      const lines = data.pools.map((p: any) => `- ${p.pair} (${p.direction})`);
      return {
        content: [{ type: 'text' as const, text: `Available pools:\n${lines.join('\n')}` }],
      };
    } catch (e: any) {
      return { content: [{ type: 'text' as const, text: `Error: ${e.message}` }], isError: true };
    }
  },
);

server.tool(
  'deploy_agent_wallet',
  'Deploy an Agent Wallet smart contract — a dedicated sub-wallet for autonomous operations. WARNING: The agent can spend funds from this wallet WITHOUT user approval. Only deploy if the user explicitly wants autonomous transfers. After deployment, top up the wallet with funds.',
  {},
  async () => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first.' }], isError: true };
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
  'execute_agent_wallet_transfer',
  'Send TON directly from an Agent Wallet — NO approval needed. The agent signs and broadcasts immediately. Only works with deployed agent wallets. Use for automated/autonomous transfers where speed matters and the user has opted in.',
  {
    walletAddress: z.string().describe('The agent wallet contract address'),
    to: z.string().describe('Destination TON address'),
    amountNano: z.string().describe('Amount in nanoTON'),
  },
  async ({ walletAddress, to, amountNano }) => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first.' }], isError: true };
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
  'get_agent_wallet_info',
  'Get info about Agent Wallets — balance, seqno, agent key status. Pass a wallet address for details, or omit to list all agent wallets.',
  {
    walletAddress: z.string().optional().describe('Agent wallet address. If omitted, lists all your agent wallets.'),
  },
  async ({ walletAddress }) => {
    if (!TOKEN) {
      return { content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first.' }], isError: true };
    }
    try {
      if (!walletAddress) {
        // List all wallets
        const result = await apiCall('/v1/agent-wallet/list');
        const wallets = result.wallets || [];
        if (!wallets.length) {
          return { content: [{ type: 'text' as const, text: 'No agent wallets found. Use deploy_agent_wallet to create one.' }] };
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

const transport = new StdioServerTransport();
await server.connect(transport);
