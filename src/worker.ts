/**
 * Cloudflare Worker entry point for MCP HTTP transport.
 * Serves the MCP server over HTTP for Smithery and remote clients.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

function createMcpServer() {
  const server = new McpServer({ name: 'tongateway', version: '0.13.0' });

  server.tool('list_tools', 'List all 16 tools available in @tongateway/mcp', {}, async () => {
    return {
      content: [{
        type: 'text' as const,
        text: [
          'Available tools in @tongateway/mcp (v0.13.0):',
          '',
          'Auth: request_auth, get_auth_token',
          'Wallet: get_wallet_info, get_jetton_balances, get_transactions, get_nft_items',
          'Transfers: request_transfer, get_request_status, list_pending_requests',
          'Lookup: resolve_name, get_ton_price',
          'DEX: create_dex_order, list_dex_pairs',
          'Agent Wallet: deploy_agent_wallet, execute_agent_wallet_transfer, get_agent_wallet_info',
          '',
          'Install locally for full access: npx -y @tongateway/mcp',
          'Docs: https://tongateway.ai/docs',
        ].join('\n'),
      }],
    };
  });

  return server;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health / info
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return new Response(JSON.stringify({
        ok: true,
        name: '@tongateway/mcp',
        version: '0.13.0',
        tools: 16,
        transport: 'streamable-http',
        endpoint: '/mcp',
        install: 'npx -y @tongateway/mcp',
        docs: 'https://tongateway.ai/docs',
      }), { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    // MCP endpoint
    if (url.pathname === '/mcp') {
      try {
        const server = createMcpServer();
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });
        await server.connect(transport);
        const response = await transport.handleRequest(request);

        // Add CORS headers
        const newHeaders = new Headers(response.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) {
          newHeaders.set(k, v);
        }
        return new Response(response.body, { status: response.status, headers: newHeaders });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
    }

    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  },
};
