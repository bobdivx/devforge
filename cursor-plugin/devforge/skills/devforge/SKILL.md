---
name: devforge
description: Use the DevForge MCP on web.jeser.app to list projects, inspect deploys, and read logs. Use when the user mentions DevForge, web.jeser.app, or a DevForge project.
---

# DevForge

The public instance is https://web.jeser.app. Its MCP endpoint is https://web.jeser.app/api/v1/mcp.

Connect with OAuth (PKCE, no client secret) or a `dfat_…` token from Account → Tokens. Do not invent project ids or deploy status; call the MCP tools. jeser.app is the showcase site, not the API.
