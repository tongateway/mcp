#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_URL = process.env.AGENT_GATEWAY_API_URL ?? 'https://api.tongateway.ai';
let TOKEN = process.env.AGENT_GATEWAY_TOKEN || '';

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

      // Store the token for future API calls
      TOKEN = data.token;

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

const transport = new StdioServerTransport();
await server.connect(transport);
