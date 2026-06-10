# agent-mcp-manager

> Programmatic add/link/unlink for **Model Context Protocol** servers across
> AI coding agents — Claude Code, Claude Desktop, Cursor, VS Code, Codex,
> Gemini CLI, Zed.

> [!WARNING]
> **Alpha software.** This package is in active development. The public
> API may change between minor versions without notice until `1.0.0`.
> Pin exact versions; expect rough edges.

`agent-mcp-manager` is built around seven primitives — `add`, `link`,
`unlink`, `remove`, `listServers`, `listLinks`, `rescan` — backed by a
caller-supplied workspace directory and a versioned manifest stored
inside it. It targets hosts (IDE plugins, internal tools, enterprise
onboarding flows, custom installers) that need to register MCP servers
in a user's agent config files without shelling out to a per-agent CLI.

> **Library, not a CLI.** If you want to register a single MCP server in
> one of your editors interactively, use that editor's own command
> (`claude mcp add …`, `cursor` settings UI, etc.) or `docker mcp client
> connect`. This package is a programmatic API for embedders.

## How this relates to `docker/mcp-gateway`

`agent-mcp-manager` derives its agent catalog from `docker/mcp-gateway`'s
`pkg/client/config.yml` (MIT-licensed). The per-OS paths, install-check
heuristics, and config-file shapes mirror the upstream entries.

What's different:

- **TypeScript-native emitters** instead of yq expressions. We use
  [`jsonc-parser`](https://www.npmjs.com/package/jsonc-parser) for the
  JSON/JSONC clients and [`@iarna/toml`](https://www.npmjs.com/package/@iarna/toml)
  for Codex. JSONC comment preservation is built in.
- **General-purpose**, not Docker-specific. Docker's CLI plugin writes a
  single fixed `MCP_DOCKER` entry pointing at its gateway. This library
  writes arbitrary MCP server entries from caller-supplied specs.
- **Manifest-backed**: a `manifest.json` records *which* entries we
  wrote so `unlink()` can refuse to clobber user-owned keys.

See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for upstream
attribution.

## Mental model

Two layers, clear split of responsibility:

- **Workspace** (yours): a directory you own with a `manifest.json`
  recording every server you've added, its spec, when, and which agents
  you've linked it to. `add()` writes here; `listServers()` reads it.
- **Agent MCP configs** (the user's): `~/.claude.json`, `~/.cursor/mcp.json`,
  `~/.codex/config.toml`, etc. `link()` injects entries into them;
  `unlink()` removes them; `listLinks()` reports the ones the manifest
  knows about. Foreign keys at those paths are never touched.

The manifest is authoritative for **intent and metadata**; the on-disk
config files are authoritative for **current state**. `rescan()`
cross-checks the two and flags drift / orphan / unmanaged entries.

## Quick start

```ts
import { createMcpManager, detectInstalledAgents } from 'agent-mcp-manager'

const mgr = createMcpManager()

await mgr.add({
  name: 'github',
  spec: {
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
  },
})

const agents = await detectInstalledAgents()
for (const a of agents.filter((a) => a.installed)) {
  await mgr.link({ serverName: 'github', agent: a.id })
}

// Later, full teardown across every linked agent:
await mgr.remove({ serverName: 'github' })
```

## Supported agents (v0.1)

| Agent | System config (macOS) | Emitter | Project file |
|---|---|---|---|
| `claude-code` | `~/.claude.json` | JSON `mcpServers` | `.mcp.json` |
| `claude-desktop` | `~/Library/Application Support/Claude/claude_desktop_config.json` | JSONC `mcpServers` | — |
| `cursor` | `~/.cursor/mcp.json` | JSON `mcpServers` | `.cursor/mcp.json` |
| `vscode` | `~/Library/Application Support/Code/User/mcp.json` | JSON `servers` (injects `type: stdio`) | `.vscode/mcp.json` |
| `gemini` | `~/.gemini/settings.json` | JSON `mcpServers` | — |
| `codex` | `~/.codex/config.toml` | TOML `mcp_servers` | — |
| `zed` | `~/.config/zed/settings.json` | JSON `context_servers` (injects `source: custom`, `enabled: true`) | — |

More agents (Cline, Continue.dev, OpenCode, Goose, Crush, LMStudio,
Kiro, Sema4) land in v0.2.

## Transport support

- `stdio` — fully supported in v0.1
- `sse` and `http` — types are exported and the JSON emitters write them
  correctly; v0.1 tests skip non-stdio link flows. Treat as preview.

## API

### `createMcpManager(options?)`

```ts
interface McpManagerOptions {
  workspaceDir?: string                                  // default: ~/.acpx/mcp
  agentConfigPaths?: Partial<Record<AgentId, string>>    // per-agent override
  scope?: 'system' | 'project'                           // default: 'system'
  projectRoot?: string                                   // required when scope === 'project'
}
```

### Primitives

```ts
interface McpManager {
  add(opts: { name: string; spec: McpServerSpec }): Promise<AddServerResult>
  link(opts: { serverName: string; agent: AgentId; configPath?: string }): Promise<LinkServerResult>
  unlink(opts: { serverName: string; agent: AgentId; configPath?: string }): Promise<UnlinkServerResult>
  remove(opts: { serverName: string; unlinkFirst?: boolean }): Promise<void>
  listServers(opts?: { scanUnmanaged?: boolean }): Promise<InstalledServer[]>
  listLinks(opts?: { agents?: AgentId[]; serverNames?: string[]; scanUnmanaged?: boolean }): Promise<McpServerLink[]>
  rescan(opts?: { mode?: 'merge' | 'replace' }): Promise<RescanResult>
}
```

### Detection helpers

```ts
detectInstalledAgents(): Promise<AgentInfo[]>
listSupportedAgents(): AgentId[]
isAgentSupported(agent: string): agent is AgentId
resolveAgentMcpConfigPath(agent: AgentId, scope?: AgentScope, projectRoot?: string): Promise<string>
```

## Errors

Every error subclasses `McpManagerError`:

| Error | When |
|---|---|
| `AgentNotSupportedError` | Unknown agent id |
| `ServerNotFoundError` | Operation on a server name absent from the manifest |
| `ForeignEntryError` | `unlink` sees an entry the manifest didn't write |
| `InvalidServerSpecError` | Spec fails validation (e.g. http transport with no url) |
| `UnresolvedConfigPathError` | OS or env vars don't yield a valid config path |

## Secrets — read this

The manifest stores the server spec **verbatim**, including any `env` /
`headers` values you pass. If your spec carries a token, the manifest
holds it in plaintext at `${workspaceDir}/manifest.json`. v0.2 will add
optional OS-keyring indirection via `keytar`. For v0.1: keep your
workspace dir scoped to a single user and treat `manifest.json` like any
other secret-bearing config file.

## License

MIT © Dani Akash
