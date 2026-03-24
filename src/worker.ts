/**
 * Cloudflare Worker entry point for MCP HTTP transport.
 * Serves the MCP server over HTTP for Smithery and remote clients.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const API_URL = 'https://api.tongateway.ai';

// Simplified worker version — no local file storage, token passed via env or per-request
async function apiCall(path: string, token: string, options: RequestInit = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json();
  if (!res.ok) throw new Error((data as any).error ?? `API error ${res.status}`);
  return data;
}

function createMcpServer() {
  const server = new McpServer({ name: 'tongateway', version: '0.13.0' });

  // Register a minimal set of tools that proxy to the API
  server.tool('get_wallet_info', 'Get wallet address, TON balance, and account status.', {}, async () => {
    return { content: [{ type: 'text' as const, text: 'Use the stdio transport (npx @tongateway/mcp) for full tool access. This HTTP endpoint is for discovery and listing only.' }] };
  });

  // List all available tools for discovery
  server.tool('list_tools', 'List all available tools in @tongateway/mcp', {}, async () => {
    return {
      content: [{
        type: 'text' as const,
        text: [
          'Available tools in @tongateway/mcp:',
          '',
          'Auth: request_auth, get_auth_token',
          'Wallet: get_wallet_info, get_jetton_balances, get_transactions, get_nft_items',
          'Transfers: request_transfer, get_request_status, list_pending_requests',
          'Lookup: resolve_name, get_ton_price',
          'DEX: create_dex_order, list_dex_pairs',
          'Agent Wallet: deploy_agent_wallet, execute_agent_wallet_transfer, get_agent_wallet_info',
          '',
          'Install locally: npx -y @tongateway/mcp',
          'Docs: https://tongateway.ai/docs',
        ].join('\n'),
      }],
    };
  });

  return server;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Health
    if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      return new Response(JSON.stringify({
        ok: true,
        name: '@tongateway/mcp',
        version: '0.13.0',
        tools: 16,
        install: 'npx -y @tongateway/mcp',
        docs: 'https://tongateway.ai/docs',
      }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    // MCP endpoint
    if (url.pathname === '/mcp') {
      try {
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
        await server.connect(transport);
        return await transport.handleRequest(request);
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    return new Response('Not found', { status: 404 });
  },
};
