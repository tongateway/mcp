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
  'Request wallet authentication. Generates a one-time link for the user to connect their TON wallet. After the user connects, use get_auth_token to retrieve the token. Use this when no token is configured.',
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
  'Check if the user has completed wallet authentication and retrieve the token. Call this after request_auth once the user has opened the link and connected their wallet.',
  {
    authId: z.string().describe('The authId returned by request_auth'),
  },
  async ({ authId }) => {
    try {
      const result = await fetch(`${API_URL}/v1/auth/check/${authId}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await result.json() as any;
      if (!result.ok) throw new Error(data.error ?? 'Failed');

      if (data.status === 'pending') {
        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Authentication still pending.`,
                `The user has not connected their wallet yet.`,
                ``,
                `Wait a moment and try again.`,
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
  'Request a TON transfer from the wallet owner. The request will be queued and the owner must approve it via TON Connect.',
  {
    to: z.string().describe('Destination TON address'),
    amountNano: z.string().describe('Amount in nanoTON (1 TON = 1000000000)'),
    payloadBoc: z.string().optional().describe('Optional BOC-encoded payload for the transaction'),
  },
  async ({ to, amountNano, payloadBoc }) => {
    if (!TOKEN) {
      return {
        content: [{ type: 'text' as const, text: 'No token configured. Use request_auth first to authenticate.' }],
        isError: true,
      };
    }
    try {
      const body: Record<string, string> = { to, amountNano };
      if (payloadBoc) body.payloadBoc = payloadBoc;

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
  'Check the status of a previously submitted transfer request.',
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
  'List all pending transfer requests waiting for wallet owner approval.',
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
  'Get the connected wallet address, TON balance, and account status.',
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
  'Get all jetton (token) balances in the connected wallet. Shows USDT, NOT, DOGS, and other tokens.',
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
  'Get recent transaction history for the connected wallet.',
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
  'List NFTs owned by the connected wallet.',
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
  'Resolve a .ton domain name to a wallet address. Use this when the user says "send to alice.ton" instead of a raw address.',
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
  'Get the current price of TON in USD and other currencies.',
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

const transport = new StdioServerTransport();
await server.connect(transport);
