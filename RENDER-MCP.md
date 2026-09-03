# Render MCP Setup

This project uses Render's hosted MCP server so you (or an AI agent) can manage
the deployment from natural-language prompts — create services, set environment
variables, trigger deploys, query the database, and inspect logs.

- Hosted MCP server: `https://mcp.render.com/mcp`
- Official docs: https://render.com/docs/mcp
- Open-source server: https://github.com/render-oss/render-mcp-server

## 1. Connect an AI tool

### Claude Code (recommended)

Run this once, then authenticate through the browser:

```bash
claude mcp add --transport http --client-id claude render https://mcp.render.com/mcp
```

Then inside Claude Code:

```
/mcp
```

Select `render`, choose **Authenticate**, and complete the OAuth flow in your
browser.

### Cursor / other tools using `.mcp.json`

The repo already includes `.mcp.json` pointing at the hosted server:

```json
{
  "mcpServers": {
    "render": {
      "type": "http",
      "url": "https://mcp.render.com/mcp"
    }
  }
}
```

Open the `.mcp.json` file in your editor and click **Approve** when prompted, then
authenticate with OAuth.

### Non-interactive / API-key mode (agents, CI)

Use the local MCP server executable with a Render API key. Create an API key at
**Render Dashboard → Account Settings → API Keys**, then configure:

```json
{
  "mcpServers": {
    "render": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "RENDER_API_KEY",
        "-v",
        "render-mcp-server-config:/config",
        "ghcr.io/render-oss/render-mcp-server"
      ],
      "env": {
        "RENDER_API_KEY": "<YOUR_API_KEY>"
      }
    }
  }
}
```

## 2. Select your workspace

All MCP actions are scoped to a workspace. Set it with a prompt like:

```
Set my Render workspace to [WORKSPACE_NAME]
```

## 3. Useful prompts

**Create the whole stack** (uses the repo's `render.yaml` blueprint):

```
Create the services defined in render.yaml from https://github.com/cartoonwithindian/voting
```

**Or create services individually:**

```
Create a Postgres database named voteweb-db with 256 MB storage
Create a Node web service from https://github.com/cartoonwithindian/voting
  named voteweb-backend with root directory . , build command "npm install",
  start command "node src/server.js", health check path /api/health
Create a Node web service from https://github.com/cartoonwithindian/voting
  named voteweb-frontend with root directory voteweb-Frontend,
  build command "npm ci --include=dev && npm run build",
  start command "npm start"
```

**Environment variables** (set on the backend):

```
Set the environment variables of voteweb-backend to:
NODE_ENV=production, PORT=10000, COOKIE_SECURE=true, DB_SSL=true,
DATABASE_URL=<postgres internal url>, SESSION_SECRET=<random>,
TOTP_ENCRYPTION_KEY=<random>, CORS_ORIGIN=<frontend url>, FRONTEND_URL=<frontend url>
```

**Deploy / redeploy:**

```
Deploy voteweb-backend
Redeploy voteweb-frontend and clear the build cache
```

**Database / logs / metrics:**

```
Run a read-only query on voteweb-db: SELECT COUNT(*) FROM students
Pull the most recent error-level logs for voteweb-backend
What was the busiest traffic day for voteweb-frontend this month?
```

## 4. After deploy: migrations & seed

The backend service runs `npm run migrate` automatically before each deploy
(`preDeployCommand`). Seed data must be run once after the first deploy — use
the Render shell for `voteweb-backend`:

```bash
node seed-auth.js
node seed.js
```

## 5. Service layout (from render.yaml)

| Service | Type | Root dir | Build | Start |
|---|---|---|---|---|
| `voteweb-db` | Postgres (basic-256mb) | — | — | — |
| `voteweb-backend` | Web (starter) | `.` (repo root) | `npm install` | `node src/server.js` |
| `voteweb-frontend` | Web (starter) | `voteweb-Frontend` | `npm ci --include=dev && npm run build` | `npm start` |

## 6. Limitations

- MCP supports creating: web services, static sites, cron jobs, Postgres, and
  Key Value. Other types must be created in the dashboard.
- Only deploys and environment-variable updates can be modified via MCP; other
  changes (scaling, deletion) require the dashboard or REST API.
- The MCP server may expose secrets (connection strings) in agent context —
  treat credentials carefully.
