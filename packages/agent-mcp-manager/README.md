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
cross-checks the two and reports `verified` / `broken` / `unmanaged`
entries. Drift detection (deep-compare manifest spec vs on-disk entry)
is planned for v0.2.

## Quick start

```ts
import { createMcpManager, detectInstalledAgents } from 'agent-mcp-manager'

const mgr = createMcpManager()

// stdio transport — broadest agent compatibility, including Codex.
await mgr.add({
  name: 'filesystem',
  spec: {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
  },
})

const agents = await detectInstalledAgents()
for (const a of agents.filter((a) => a.installed)) {
  await mgr.link({ serverName: 'filesystem', agent: a.id })
}

// Later, full teardown across every linked agent:
await mgr.remove({ serverName: 'filesystem' })
```

### Wrapping a remote MCP for stdio-only agents

Three of the supported agents only accept stdio entries on disk:

- `claude-desktop` (the system `claude_desktop_config.json` parser rejects entries without a `command` field)
- `codex` (no remote-URL schema upstream)
- `claude-code` at project scope (`.mcp.json` requires the `type: "stdio"` tag)

For these agents, wrap the URL with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) and register the wrapper as a stdio spec:

```ts
await mgr.add({
  name: 'browseros',
  spec: {
    transport: 'stdio',
    command: 'npx',
    args: [
      '-y',
      'mcp-remote',
      'https://browseros.example.com/mcp',
      '--header',
      `Authorization: Bearer ${process.env.BROWSEROS_TOKEN}`,
    ],
  },
})

for (const a of (await detectInstalledAgents()).filter((a) => a.installed)) {
  await mgr.link({ serverName: 'browseros', agent: a.id })
}
```

`mcp-remote` translates the stdio protocol the agent speaks into the HTTP/SSE protocol the remote server speaks. The library does NOT do this translation automatically in v0.0.2; auto-shim is on the v0.2 roadmap so the manifest stays a faithful record of intent.

### Fanning out without wrapping

If you would rather keep the http spec as-is and skip clients that cannot accept it, catch `UnsupportedTransportError` per-agent:

```ts
import { UnsupportedTransportError } from 'agent-mcp-manager'

await mgr.add({
  name: 'github',
  spec: {
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
  },
})

for (const a of (await detectInstalledAgents()).filter((a) => a.installed)) {
  try {
    await mgr.link({ serverName: 'github', agent: a.id })
  } catch (err) {
    if (err instanceof UnsupportedTransportError) continue
    throw err
  }
}
```

Or pre-filter by reading the per-agent capability list off the catalog directly. Use `resolveAgentSurface(id, scope)` rather than `getCatalogEntry(id).supportedTransports` so the filter matches the scope you will pass to `link()` (e.g. `claude-code` is stdio-only at project scope but accepts all three at system scope):

```ts
import {
  resolveAgentSurface,
  type AgentId,
  type AgentScope,
  type McpTransport,
} from 'agent-mcp-manager'

const scope: AgentScope = 'system'
const supports = (id: AgentId, t: McpTransport) =>
  resolveAgentSurface(id, scope).supportedTransports.includes(t)

for (const a of (await detectInstalledAgents()).filter((a) => a.installed)) {
  if (!supports(a.id, 'http')) continue
  await mgr.link({ serverName: 'github', agent: a.id })
}
```

## Supported agents (v0.1)

| Agent | System config (macOS) | Emitter | Project file |
|---|---|---|---|
| `claude-code` | `~/.claude.json` | JSON `mcpServers` | `.mcp.json` |
| `claude-desktop` | `~/Library/Application Support/Claude/claude_desktop_config.json` | JSONC `mcpServers` | — |
| `cursor` | `~/.cursor/mcp.json` | JSON `mcpServers` | `.cursor/mcp.json` |
| `vscode` | `~/Library/Application Support/Code/User/mcp.json` | JSON `servers` (injects `type:` matching `spec.transport`) | `.vscode/mcp.json` |
| `gemini` | `~/.gemini/settings.json` | JSON `mcpServers` | — |
| `codex` | `~/.codex/config.toml` | TOML `mcp_servers` | — |
| `zed` | `~/.config/zed/settings.json` | JSON `context_servers` (injects `source: custom`, `enabled: true`) | — |

More agents (Cline, Continue.dev, OpenCode, Goose, Crush, LMStudio,
Kiro, Sema4) land in v0.2.

## Transport support

`stdio` is supported by every agent in the catalog. `sse` and `http` are accepted by Claude Code (system scope only), Cursor, VS Code, Gemini, and Zed. Three agents are stdio-only because their config files only validate stdio-shaped entries:

| Agent | Why stdio-only |
|---|---|
| `claude-desktop` | `claude_desktop_config.json` is parsed strictly. Entries without a `command` field are reported as "not a valid MCP server configuration and were skipped" on app launch. |
| `codex` | `~/.codex/config.toml` has no remote-URL schema upstream. Only the stdio shape (`command`, `args`, `env`) is accepted. |
| `claude-code` project scope (`.mcp.json`) | Newer Claude Code requires `type: "stdio"` on project entries; project-scope writes inject the tag and reject non-stdio. System scope (`~/.claude.json`) still accepts all three. |

Calling `link({ agent, ... })` with an `http` or `sse` spec on a stdio-only agent throws `UnsupportedTransportError` before any file write. The error message includes an `mcp-remote` shim recipe. See [Wrapping a remote MCP for stdio-only agents](#wrapping-a-remote-mcp-for-stdio-only-agents) above for the resolution.

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
  link(opts: { serverName: string; agent: AgentId; configPath?: string; allowOverwrite?: boolean }): Promise<LinkServerResult>
  unlink(opts: { serverName: string; agent: AgentId; configPath?: string }): Promise<UnlinkServerResult>
  remove(opts: { serverName: string; unlinkFirst?: boolean }): Promise<void>
  listServers(opts?: { scanUnmanaged?: boolean }): Promise<InstalledServer[]>
  listLinks(opts?: { agents?: AgentId[]; serverNames?: string[]; scanUnmanaged?: boolean }): Promise<McpServerLink[]>
  rescan(opts?: { mode?: 'merge' | 'replace' }): Promise<RescanResult>
}
```

#### `link({ allowOverwrite })`

Default `false`. When the on-disk config already contains an entry under `serverName` that the manifest did not write, `link()` throws `ForeignEntryError` to protect the user from clobbering an entry another tool put there. Set `allowOverwrite: true` to take ownership instead: the on-disk entry is rewritten with the manifest's spec and a fresh `links[agent]` record is added. Use this when recovering from a relocated workspace manifest, or when intentionally taking over an entry a prior installer wrote.

`allowOverwrite` only bypasses the foreign-entry guard. It does NOT bypass the transport-capability check; a `claude-desktop` link with an `http` spec still throws `UnsupportedTransportError` regardless of this flag.

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
| `ForeignEntryError` | `unlink` (or `link` without `allowOverwrite: true`) sees an entry the manifest didn't write |
| `InvalidServerSpecError` | Spec fails validation (e.g. http transport with no url) |
| `UnresolvedConfigPathError` | OS or env vars don't yield a valid config path |
| `UnsupportedTransportError` | `link({ agent, spec })` requested a transport the agent's config does not accept (e.g. `http` on `claude-desktop`). Includes `agent`, `transport`, and `details.supported` plus an `mcp-remote` shim hint. |

## Secrets — read this

The manifest stores the server spec **verbatim**, including any `env` /
`headers` values you pass. If your spec carries a token, the manifest
holds it in plaintext at `${workspaceDir}/manifest.json`. v0.2 will add
optional OS-keyring indirection via `keytar`. For v0.1: keep your
workspace dir scoped to a single user and treat `manifest.json` like any
other secret-bearing config file.

## License

MIT © Dani Akash
