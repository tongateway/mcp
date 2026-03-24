/**
 * Cloudflare Worker — MCP HTTP transport for Smithery and remote clients.
 * Mirrors all 16 tools from the stdio version with full descriptions and annotations.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

const VERSION = '0.13.0';

function createMcpServer() {
  const server = new McpServer({
    name: 'tongateway',
    version: VERSION,
  });

  // --- Auth ---

  server.tool(
    'request_auth',
    'Authenticate with TON blockchain. Generates a one-time link for the user to connect their wallet. After the user opens the link, call get_auth_token to complete authentication.',
    { label: z.string().optional().describe('Label for this agent session, e.g. "claude-agent"') },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport (npx @tongateway/mcp) for full tool execution.' }] }),
  );

  server.tool(
    'get_auth_token',
    'Complete authentication after the user opened the link from request_auth. Returns the token which enables all other tools.',
    { authId: z.string().describe('The authId returned by request_auth') },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  // --- Wallet ---

  server.tool(
    'get_wallet_info',
    'Get the connected wallet address, TON balance in nanoTON and human-readable format, and account status (active/uninitialized).',
    {},
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'get_jetton_balances',
    'List all jetton (token) balances in the wallet — USDT, NOT, DOGS, BUILD, and others. Returns symbol, name, balance, and decimals for each token.',
    {},
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'get_transactions',
    'Get recent transaction history for the connected wallet. Shows timestamps, action types, and scam flags.',
    { limit: z.number().optional().describe('Number of transactions to return (default 10, max 100)') },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'get_nft_items',
    'List all NFTs owned by the connected wallet — name, collection name, and contract address for each.',
    {},
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  // --- Transfers ---

  server.tool(
    'request_transfer',
    'Request a TON transfer that the wallet owner must approve. Amount is in nanoTON (1 TON = 1000000000). Supports optional payload BOC and stateInit for contract deployment. Use get_request_status to check approval.',
    {
      to: z.string().describe('Destination TON address (raw format 0:abc... or friendly EQ...)'),
      amountNano: z.string().describe('Amount in nanoTON. 1 TON = 1000000000 nanoTON'),
      payload: z.string().optional().describe('Optional BOC-encoded payload for the transaction'),
      stateInit: z.string().optional().describe('Optional stateInit BOC for deploying new smart contracts'),
    },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'get_request_status',
    'Check the status of a transfer request. Returns: pending (waiting for approval), confirmed (signed and broadcast), rejected (user declined), or expired (5 min timeout). Also shows broadcast result if available.',
    { id: z.string().describe('The request ID returned by request_transfer') },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'list_pending_requests',
    'List all transfer requests currently waiting for wallet owner approval.',
    {},
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  // --- Lookup ---

  server.tool(
    'resolve_name',
    'Resolve a .ton domain name (e.g. "alice.ton") to a raw wallet address. Always use this before request_transfer when the user provides a .ton name.',
    { domain: z.string().describe('The .ton domain name to resolve, e.g. "alice.ton" or "foundation.ton"') },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'get_ton_price',
    'Get the current price of TON in USD, EUR, or other fiat currencies. Use to show users the value of their holdings.',
    { currencies: z.string().optional().describe('Comma-separated currency codes, e.g. "USD,EUR". Default: "USD"') },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  // --- DEX ---

  server.tool(
    'create_dex_order',
    'Place a limit order on the open4dev DEX order book. Provide token pair, amount in smallest units, and human-readable price. The API handles decimal conversion, slippage (4% including fees), and gas automatically.',
    {
      fromToken: z.string().describe('Token to sell: TON, NOT, USDT, DOGS, BUILD, AGNT, CBBTC, PX, XAUT0'),
      toToken: z.string().describe('Token to buy: TON, NOT, USDT, DOGS, BUILD, AGNT, CBBTC, PX, XAUT0'),
      amount: z.string().describe('Amount to sell in smallest unit. TON/NOT/DOGS/BUILD/AGNT use 9 decimals. USDT/XAUT0 use 6 decimals.'),
      price: z.number().describe('Human-readable price: how many toToken per 1 fromToken. E.g. price=20 means "1 USDT = 20 AGNT".'),
    },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'list_dex_pairs',
    'List all available trading pairs and tokens on the open4dev DEX. Returns supported tokens: TON, NOT, USDT, DOGS, BUILD, AGNT, CBBTC, PX, XAUT0.',
    {},
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  // --- Agent Wallet ---

  server.tool(
    'deploy_agent_wallet',
    'Deploy an Agent Wallet smart contract — a dedicated sub-wallet for autonomous transfers without approval. WARNING: The agent can spend all funds in this wallet without user confirmation. Only deploy when the user explicitly requests autonomous mode.',
    {},
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'execute_agent_wallet_transfer',
    'Send TON directly from an Agent Wallet — NO approval needed. Signs and broadcasts the transaction immediately. Only works with deployed agent wallets where the agent key is authorized.',
    {
      walletAddress: z.string().describe('The agent wallet contract address'),
      to: z.string().describe('Destination TON address'),
      amountNano: z.string().describe('Amount in nanoTON (1 TON = 1000000000)'),
    },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'get_agent_wallet_info',
    'Get info about Agent Wallets — balance, seqno, and agent key status. Pass a wallet address for details, or omit to list all your agent wallets.',
    { walletAddress: z.string().optional().describe('Agent wallet address. Omit to list all wallets.') },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  // --- Prompts ---

  server.prompt(
    'quickstart',
    'How to get started with Agent Gateway on TON blockchain',
    async () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: 'Install: npx -y @tongateway/mcp\n\nClaude Code: claude mcp add-json tongateway \'{"command":"npx","args":["-y","@tongateway/mcp"],"env":{"AGENT_GATEWAY_API_URL":"https://api.tongateway.ai"}}\' --scope user\n\nThen say: "Send 1 TON to alice.ton"',
        },
      }],
    }),
  );

  server.prompt(
    'token-reference',
    'Amount conversion reference for TON blockchain',
    async () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: 'TON amounts are in nanoTON (1 TON = 10^9 nanoTON):\n0.1 TON = 100000000\n0.5 TON = 500000000\n1 TON = 1000000000\n10 TON = 10000000000\n\nUSDT/XAUT0 use 6 decimals. All other jettons use 9 decimals.',
        },
      }],
    }),
  );

  // --- Resources ---

  server.resource(
    'docs',
    'https://tongateway.ai/docs',
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/plain',
        text: 'Agent Gateway documentation: https://tongateway.ai/docs\nAPI Swagger: https://api.tongateway.ai/docs\nSkill file: https://tongateway.ai/agent-gateway.md',
      }],
    }),
  );

  server.resource(
    'skill',
    'https://tongateway.ai/agent-gateway.md',
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/plain',
        text: 'Skill file with all 16 tool descriptions, usage examples, and amount conversion: https://tongateway.ai/agent-gateway.md',
      }],
    }),
  );

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

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return new Response(JSON.stringify({
        ok: true,
        name: '@tongateway/mcp',
        version: VERSION,
        description: 'TON blockchain gateway for AI agents — 16 tools for wallet info, transfers, jettons, NFTs, DNS, prices, DEX orders, and agent wallets.',
        tools: 16,
        prompts: 2,
        resources: 2,
        transport: 'streamable-http',
        endpoint: '/mcp',
        install: 'npx -y @tongateway/mcp',
        homepage: 'https://tongateway.ai',
        docs: 'https://tongateway.ai/docs',
        repository: 'https://github.com/tongateway/mcp',
      }), { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    if (url.pathname === '/mcp') {
      try {
        const server = createMcpServer();
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined as any,
        });
        await server.connect(transport);
        const response = await transport.handleRequest(request);

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
