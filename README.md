# @tongateway/mcp

MCP server for [Agent Gateway](https://github.com/pewpewgogo/ton-agent-gateway) — lets AI agents request TON blockchain transfers via Model Context Protocol.

## Install

```bash
npm install -g @tongateway/mcp
```

## Configure

Add to your MCP client config (Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "tongateway": {
      "command": "tongateway-mcp",
      "env": {
        "AGENT_GATEWAY_TOKEN": "YOUR_TOKEN_HERE",
        "AGENT_GATEWAY_API_URL": "https://api.tongateway.ai"
      }
    }
  }
}
```

Get your token at [tongateway.ai/app.html](https://tongateway.ai/app.html).

## Tools

| Tool | Description |
|---|---|
| `request_transfer` | Request a TON transfer (to, amountNano, payloadBoc?) |
| `get_request_status` | Check status of a request by ID |
| `list_pending_requests` | List all pending requests |

## Links

- [Agent Gateway](https://github.com/pewpewgogo/ton-agent-gateway) — main repo with all links
- [Dashboard](https://tongateway.ai) — connect wallet & manage tokens
- [API Docs](https://api.tongateway.ai/docs) — Swagger UI
