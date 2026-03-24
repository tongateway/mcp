/**
 * Cloudflare Worker — MCP HTTP transport for Smithery and remote clients.
 * Mirrors all 16 tools from the stdio version with full descriptions and annotations.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

const VERSION = '0.14.0';

function createMcpServer() {
  const server = new McpServer({
    name: 'tongateway',
    version: VERSION,
  });

  // --- Auth ---

  server.tool(
    'auth.request',
    'Authenticate with TON blockchain. Generates a one-time link for the user to connect their wallet. After the user opens the link, call auth.get_token to complete authentication.',
    { label: z.string().optional().describe('Label for this agent session, e.g. "claude-agent"') },
    { title: 'Request Authentication', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport (npx @tongateway/mcp) for full tool execution.' }] }),
  );

  server.tool(
    'auth.get_token',
    'Complete authentication after the user opened the link from auth.request. Returns the token which enables all other tools.',
    { authId: z.string().describe('The authId returned by auth.request') },
    { title: 'Get Auth Token', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  // --- Wallet ---

  server.tool(
    'wallet.info',
    'Get the connected wallet address, TON balance in nanoTON and human-readable format, and account status (active/uninitialized).',
    {},
    { title: 'Wallet Info', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'wallet.jettons',
    'List all jetton (token) balances in the wallet — USDT, NOT, DOGS, BUILD, and others. Returns symbol, name, balance, and decimals for each token.',
    {},
    { title: 'Jetton Balances', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'wallet.transactions',
    'Get recent transaction history for the connected wallet. Shows timestamps, action types, and scam flags.',
    { limit: z.number().optional().describe('Number of transactions to return (default 10, max 100)') },
    { title: 'Transaction History', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'wallet.nfts',
    'List all NFTs owned by the connected wallet — name, collection name, and contract address for each.',
    {},
    { title: 'NFT Items', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  // --- Transfers ---

  server.tool(
    'transfer.request',
    'Request a TON transfer that the wallet owner must approve. Amount is in nanoTON (1 TON = 1000000000). Supports optional payload BOC and stateInit for contract deployment. Use transfer.status to check approval.',
    {
      to: z.string().describe('Destination TON address (raw format 0:abc... or friendly EQ...)'),
      amountNano: z.string().describe('Amount in nanoTON. 1 TON = 1000000000 nanoTON'),
      payload: z.string().optional().describe('Optional BOC-encoded payload for the transaction'),
      stateInit: z.string().optional().describe('Optional stateInit BOC for deploying new smart contracts'),
    },
    { title: 'Request Transfer', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'transfer.status',
    'Check the status of a transfer request. Returns: pending (waiting for approval), confirmed (signed and broadcast), rejected (user declined), or expired (5 min timeout). Also shows broadcast result if available.',
    { id: z.string().describe('The request ID returned by transfer.request') },
    { title: 'Transfer Status', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'transfer.pending',
    'List all transfer requests currently waiting for wallet owner approval.',
    {},
    { title: 'Pending Transfers', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  // --- Lookup ---

  server.tool(
    'lookup.resolve_name',
    'Resolve a .ton domain name (e.g. "alice.ton") to a raw wallet address. Always use this before transfer.request when the user provides a .ton name.',
    { domain: z.string().describe('The .ton domain name to resolve, e.g. "alice.ton" or "foundation.ton"') },
    { title: 'Resolve .ton Name', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'lookup.price',
    'Get the current price of TON in USD, EUR, or other fiat currencies. Use to show users the value of their holdings.',
    { currencies: z.string().optional().describe('Comma-separated currency codes, e.g. "USD,EUR". Default: "USD"') },
    { title: 'TON Price', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  // --- DEX ---

  server.tool(
    'dex.create_order',
    'Place a limit order on the open4dev DEX order book. Both amount and price are human-readable. The API converts to raw units, handles slippage (4% including fees), and gas automatically.',
    {
      fromToken: z.string().describe('Token to sell: TON, NOT, USDT, DOGS, BUILD, AGNT, CBBTC, PX, XAUT0'),
      toToken: z.string().describe('Token to buy: TON, NOT, USDT, DOGS, BUILD, AGNT, CBBTC, PX, XAUT0'),
      amount: z.string().describe('Human-readable amount to sell, e.g. "10000" for 10,000 NOT or "5" for 5 USDT'),
      price: z.number().describe('Human-readable price: how many toToken per 1 fromToken. E.g. price=20 means "1 USDT = 20 AGNT".'),
    },
    { title: 'Create DEX Order', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'dex.pairs',
    'List all available trading pairs and tokens on the open4dev DEX. Returns supported tokens: TON, NOT, USDT, DOGS, BUILD, AGNT, CBBTC, PX, XAUT0.',
    {},
    { title: 'DEX Pairs', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  // --- Agent Wallet ---

  server.tool(
    'agent_wallet.deploy',
    'Deploy an Agent Wallet smart contract — a dedicated sub-wallet for autonomous transfers without approval. WARNING: The agent can spend all funds in this wallet without user confirmation. Only deploy when the user explicitly requests autonomous mode.',
    {},
    { title: 'Deploy Agent Wallet', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'agent_wallet.transfer',
    'Send TON directly from an Agent Wallet — NO approval needed. Signs and broadcasts the transaction immediately. Only works with deployed agent wallets where the agent key is authorized.',
    {
      walletAddress: z.string().describe('The agent wallet contract address'),
      to: z.string().describe('Destination TON address'),
      amountNano: z.string().describe('Amount in nanoTON (1 TON = 1000000000)'),
    },
    { title: 'Agent Wallet Transfer', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async () => ({ content: [{ type: 'text' as const, text: 'Use stdio transport for full tool execution.' }] }),
  );

  server.tool(
    'agent_wallet.info',
    'Get info about Agent Wallets — balance, seqno, and agent key status. Pass a wallet address for details, or omit to list all your agent wallets.',
    { walletAddress: z.string().optional().describe('Agent wallet address. Omit to list all wallets.') },
    { title: 'Agent Wallet Info', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
          text: `# Quick Start

## Install
\`\`\`bash
claude mcp add-json tongateway '{"command":"npx","args":["-y","@tongateway/mcp"],"env":{"AGENT_GATEWAY_API_URL":"https://api.tongateway.ai"}}' --scope user
\`\`\`

## First use
The agent authenticates automatically — it generates a link, you open it and connect your wallet once. Token persists across restarts.

## Try these commands:
- "What's my TON balance?"
- "Show my tokens"
- "Send 1 TON to alice.ton"
- "What's the current TON price?"
- "Show my NFTs"`,
        },
      }],
    }),
  );

  server.prompt(
    'token-reference',
    'Amount conversion and token decimals reference',
    async () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `# Token Reference

## Amount conversion (nanoTON)
| TON   | nanoTON        |
|-------|----------------|
| 0.1   | 100000000      |
| 0.5   | 500000000      |
| 1     | 1000000000     |
| 10    | 10000000000    |

## Token decimals
- 9 decimals: TON, NOT, DOGS, BUILD, AGNT, PX, CBBTC
- 6 decimals: USDT, XAUT0

## DEX price format
Price is human-readable: price=20 means "1 fromToken = 20 toToken"
Example: USDT→AGNT at price=20 means "1 USDT = 20 AGNT"`,
        },
      }],
    }),
  );

  server.prompt(
    'example-transfer',
    'Example: Send TON to a .ton domain with price check',
    async () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `# Example: Send TON to alice.ton

## Step 1: Check balance
wallet.info()
→ Address: 0:9d43...0c02, Balance: 823.18 TON, Status: active

## Step 2: Check price
lookup.price({ currencies: "USD" })
→ 1 TON = $2.45 USD

## Step 3: Resolve .ton domain
lookup.resolve_name({ domain: "alice.ton" })
→ alice.ton → 0:83df...31a8

## Step 4: Send transfer
transfer.request({ to: "0:83df...31a8", amountNano: "500000000" })
→ Transfer request created (ID: abc-123). Approve in your wallet app.

## Step 5: Check status
transfer.status({ id: "abc-123" })
→ Status: confirmed, Broadcast: success`,
        },
      }],
    }),
  );

  server.prompt(
    'example-dex-order',
    'Example: Place a DEX order to swap tokens',
    async () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `# Example: Swap 10,000 NOT for TON

## Step 1: Check available tokens
dex.pairs()
→ Available tokens: TON, NOT, USDT, DOGS, BUILD, AGNT, CBBTC, PX, XAUT0

## Step 2: Check your NOT balance
wallet.jettons()
→ NOT: 3,186,370.60, USDT: 107.79, BUILD: 45,277.57

## Step 3: Get current price
lookup.price({ currencies: "USD" })
→ 1 TON = $2.45 USD
(NOT ≈ 0.000289 TON per NOT)

## Step 4: Place order
dex.create_order({
  fromToken: "NOT",
  toToken: "TON",
  amount: "10000",  // human-readable, API converts to raw
  price: 0.000289            // TON per NOT
})
→ Order placed! Approve in your wallet app.`,
        },
      }],
    }),
  );

  server.prompt(
    'example-agent-wallet',
    'Example: Deploy and use an autonomous Agent Wallet',
    async () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `# Example: Autonomous Agent Wallet

⚠️ WARNING: Agent Wallet allows spending WITHOUT approval!

## Step 1: Deploy
agent_wallet.deploy()
→ Agent Wallet deployed at EQCT1... Approve 0.1 TON deploy fee in wallet.

## Step 2: Top up
transfer.request({ to: "EQCT1...", amountNano: "1000000000" })
→ Transfer 1 TON to agent wallet. Approve in wallet.

## Step 3: Send from agent wallet (NO approval needed!)
agent_wallet.transfer({
  walletAddress: "0:93d4...",
  to: "0:abc...",
  amountNano: "500000000"
})
→ Transfer executed. No approval needed.

## Check balance
agent_wallet.info({ walletAddress: "0:93d4..." })
→ Balance: 0.5 TON, Seqno: 1, Status: active`,
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
