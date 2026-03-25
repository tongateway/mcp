import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';

const MCP_PATH = join(__dirname, '..', 'dist', 'index.js');

// Helper: send JSON-RPC to MCP server via stdio
function createMcpClient() {
  let proc: ChildProcess;
  let buffer = '';
  const responses: Map<number, any> = new Map();
  let resolvers: Map<number, (value: any) => void> = new Map();

  return {
    start() {
      proc = spawn('node', [MCP_PATH], {
        env: {
          ...process.env,
          AGENT_GATEWAY_API_URL: 'https://api.tongateway.ai',
          AGENT_GATEWAY_TOKEN: '', // no token
          HOME: '/tmp/mcp-test-' + Date.now(), // prevent loading saved token
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      proc.stdout!.on('data', (data: Buffer) => {
        buffer += data.toString();
        // Parse JSON-RPC responses (newline-delimited)
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id !== undefined) {
              const resolver = resolvers.get(msg.id);
              if (resolver) {
                resolver(msg);
                resolvers.delete(msg.id);
              }
              responses.set(msg.id, msg);
            }
          } catch {}
        }
      });
    },

    async send(method: string, params: any = {}, id: number): Promise<any> {
      const msg = JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n';
      proc.stdin!.write(msg);
      return new Promise((resolve, reject) => {
        resolvers.set(id, resolve);
        setTimeout(() => {
          resolvers.delete(id);
          reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
        }, 10000);
      });
    },

    async initialize(): Promise<any> {
      return this.send('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.1.0' },
      }, 1);
    },

    async listTools(): Promise<any> {
      return this.send('tools/list', {}, 2);
    },

    async callTool(name: string, args: any = {}, id = 100): Promise<any> {
      return this.send('tools/call', { name, arguments: args }, id);
    },

    stop() {
      proc?.kill();
    },
  };
}

describe('MCP Server', () => {
  let client: ReturnType<typeof createMcpClient>;

  beforeEach(() => {
    client = createMcpClient();
    client.start();
  });

  afterEach(() => {
    client.stop();
  });

  it('initializes successfully', async () => {
    const res = await client.initialize();
    expect(res.result).toBeDefined();
    expect(res.result.serverInfo.name).toContain('agent');
  });

  it('lists all 18 tools', async () => {
    await client.initialize();
    // Send initialized notification
    await client.send('notifications/initialized', {}, 99);
    await new Promise(r => setTimeout(r, 100));

    const res = await client.listTools();
    expect(res.result.tools).toBeDefined();
    const toolNames = res.result.tools.map((t: any) => t.name);

    // Auth
    expect(toolNames).toContain('auth.request');
    expect(toolNames).toContain('auth.get_token');

    // Wallet
    expect(toolNames).toContain('wallet.info');
    expect(toolNames).toContain('wallet.jettons');
    expect(toolNames).toContain('wallet.transactions');
    expect(toolNames).toContain('wallet.nfts');

    // Transfers
    expect(toolNames).toContain('transfer.request');
    expect(toolNames).toContain('transfer.status');
    expect(toolNames).toContain('transfer.pending');
    expect(toolNames).toContain('transfer.batch');

    // Lookup
    expect(toolNames).toContain('lookup.resolve_name');
    expect(toolNames).toContain('lookup.price');

    // DEX
    expect(toolNames).toContain('dex.create_order');
    expect(toolNames).toContain('dex.pairs');

    // Agent Wallet
    expect(toolNames).toContain('agent_wallet.deploy');
    expect(toolNames).toContain('agent_wallet.transfer');
    expect(toolNames).toContain('agent_wallet.batch_transfer');
    expect(toolNames).toContain('agent_wallet.info');

    expect(toolNames.length).toBe(18);
  });

  it('all tools have descriptions', async () => {
    await client.initialize();
    await client.send('notifications/initialized', {}, 99);
    await new Promise(r => setTimeout(r, 100));

    const res = await client.listTools();
    for (const tool of res.result.tools) {
      expect(tool.description, `${tool.name} missing description`).toBeTruthy();
      expect(tool.description.length, `${tool.name} description too short`).toBeGreaterThan(20);
    }
  });

  it('all tools have annotations', async () => {
    await client.initialize();
    await client.send('notifications/initialized', {}, 99);
    await new Promise(r => setTimeout(r, 100));

    const res = await client.listTools();
    for (const tool of res.result.tools) {
      expect(tool.annotations, `${tool.name} missing annotations`).toBeDefined();
      expect(tool.annotations.title, `${tool.name} missing title`).toBeTruthy();
      expect(typeof tool.annotations.readOnlyHint, `${tool.name} missing readOnlyHint`).toBe('boolean');
    }
  });

  it('tools use dot-notation naming', async () => {
    await client.initialize();
    await client.send('notifications/initialized', {}, 99);
    await new Promise(r => setTimeout(r, 100));

    const res = await client.listTools();
    for (const tool of res.result.tools) {
      expect(tool.name, `${tool.name} not dot-notation`).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it('read-only tools are marked correctly', async () => {
    await client.initialize();
    await client.send('notifications/initialized', {}, 99);
    await new Promise(r => setTimeout(r, 100));

    const res = await client.listTools();
    const readOnlyTools = ['wallet.info', 'wallet.jettons', 'wallet.transactions', 'wallet.nfts',
      'transfer.status', 'transfer.pending', 'lookup.resolve_name', 'lookup.price',
      'dex.pairs', 'agent_wallet.info'];
    const writeTools = ['auth.request', 'auth.get_token', 'transfer.request', 'transfer.batch',
      'dex.create_order', 'agent_wallet.deploy', 'agent_wallet.transfer', 'agent_wallet.batch_transfer'];

    for (const tool of res.result.tools) {
      if (readOnlyTools.includes(tool.name)) {
        expect(tool.annotations.readOnlyHint, `${tool.name} should be readOnly`).toBe(true);
      }
      if (writeTools.includes(tool.name)) {
        expect(tool.annotations.readOnlyHint, `${tool.name} should not be readOnly`).toBe(false);
      }
    }
  });

  it('agent_wallet.transfer is marked destructive', async () => {
    await client.initialize();
    await client.send('notifications/initialized', {}, 99);
    await new Promise(r => setTimeout(r, 100));

    const res = await client.listTools();
    const transfer = res.result.tools.find((t: any) => t.name === 'agent_wallet.transfer');
    expect(transfer.annotations.destructiveHint).toBe(true);

    const batch = res.result.tools.find((t: any) => t.name === 'agent_wallet.batch_transfer');
    expect(batch.annotations.destructiveHint).toBe(true);
  });

  // --- Tool execution tests (no token) ---

  it('wallet tools return auth error without token', async () => {
    await client.initialize();
    await client.send('notifications/initialized', {}, 99);
    await new Promise(r => setTimeout(r, 100));

    // Tools with no required params
    const simpleTools = ['wallet.info', 'wallet.jettons', 'wallet.nfts',
      'transfer.pending', 'agent_wallet.deploy'];

    for (let i = 0; i < simpleTools.length; i++) {
      const res = await client.callTool(simpleTools[i], {}, 200 + i);
      const text = res.result?.content?.[0]?.text ?? '';
      expect(text, `${simpleTools[i]} should require auth`).toContain('No token configured');
    }

    // Tools with required params — pass dummy values to get past validation
    const paramTools: Array<[string, any]> = [
      ['transfer.request', { to: '0:abc', amountNano: '1000' }],
      ['transfer.status', { id: 'test-id' }],
      ['transfer.batch', { transfers: '[]' }],
      ['wallet.transactions', { limit: 5 }],
      ['dex.create_order', { fromToken: 'TON', toToken: 'NOT', amount: '1', price: 1 }],
      ['agent_wallet.transfer', { walletAddress: '0:abc', to: '0:def', amountNano: '1000' }],
      ['agent_wallet.batch_transfer', { walletAddress: '0:abc', transfers: '[]' }],
      ['agent_wallet.info', {}],
    ];

    for (let i = 0; i < paramTools.length; i++) {
      const [name, args] = paramTools[i];
      const res = await client.callTool(name, args, 220 + i);
      const text = res.result?.content?.[0]?.text ?? '';
      expect(text, `${name} should require auth`).toContain('No token configured');
    }
  });

  it('auth.request returns a link', async () => {
    await client.initialize();
    await client.send('notifications/initialized', {}, 99);
    await new Promise(r => setTimeout(r, 100));

    const res = await client.callTool('auth.request', { label: 'test' }, 300);
    const text = res.result?.content?.[0]?.text ?? '';
    expect(text).toContain('tongateway.ai/connect');
    expect(text).toContain('authId');
  });

  it('lookup.resolve_name works without token', async () => {
    await client.initialize();
    await client.send('notifications/initialized', {}, 99);
    await new Promise(r => setTimeout(r, 100));

    const res = await client.callTool('lookup.resolve_name', { domain: 'foundation.ton' }, 301);
    const text = res.result?.content?.[0]?.text ?? '';
    expect(text).toContain('foundation.ton');
    expect(text).toContain('0:');
  });

  it('lookup.price works without token', async () => {
    await client.initialize();
    await client.send('notifications/initialized', {}, 99);
    await new Promise(r => setTimeout(r, 100));

    const res = await client.callTool('lookup.price', { currencies: 'USD' }, 302);
    const text = res.result?.content?.[0]?.text ?? '';
    expect(text).toContain('TON');
    expect(text).toContain('USD');
  });

  it('dex.pairs works without token', async () => {
    await client.initialize();
    await client.send('notifications/initialized', {}, 99);
    await new Promise(r => setTimeout(r, 100));

    const res = await client.callTool('dex.pairs', {}, 303);
    const text = res.result?.content?.[0]?.text ?? '';
    expect(text).toContain('TON');
    expect(text).toContain('NOT');
  });

  // --- Parameter validation ---

  it('transfer.request has correct params', async () => {
    await client.initialize();
    await client.send('notifications/initialized', {}, 99);
    await new Promise(r => setTimeout(r, 100));

    const res = await client.listTools();
    const tool = res.result.tools.find((t: any) => t.name === 'transfer.request');
    const props = tool.inputSchema.properties;

    expect(props.to).toBeDefined();
    expect(props.amountNano).toBeDefined();
    expect(props.comment).toBeDefined();
    expect(props.payload).toBeDefined();
    expect(props.stateInit).toBeDefined();
  });

  it('dex.create_order has correct params', async () => {
    await client.initialize();
    await client.send('notifications/initialized', {}, 99);
    await new Promise(r => setTimeout(r, 100));

    const res = await client.listTools();
    const tool = res.result.tools.find((t: any) => t.name === 'dex.create_order');
    const props = tool.inputSchema.properties;

    expect(props.fromToken).toBeDefined();
    expect(props.toToken).toBeDefined();
    expect(props.amount).toBeDefined();
    expect(props.price).toBeDefined();
  });

  it('--help flag works', async () => {
    const result = await new Promise<string>((resolve) => {
      const proc = spawn('node', [MCP_PATH, '--help']);
      let output = '';
      proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
      proc.on('close', () => resolve(output));
    });

    expect(result).toContain('@tongateway/mcp');
    expect(result).toContain('auth.request');
    expect(result).toContain('wallet.info');
    expect(result).toContain('transfer.request');
  });

  it('--version flag works', async () => {
    const result = await new Promise<string>((resolve) => {
      const proc = spawn('node', [MCP_PATH, '--version']);
      let output = '';
      proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
      proc.on('close', () => resolve(output));
    });

    expect(result.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
