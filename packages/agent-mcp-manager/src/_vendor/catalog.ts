/**
 * Agent catalog for v0.1.
 *
 * Derived from `docker/mcp-gateway/pkg/client/config.yml` (MIT licensed)
 * — paths and install-check semantics mirror the upstream entries.
 * See `THIRD_PARTY_NOTICES.md` for attribution.
 *
 * v0.2+ should generate this from a vendored copy of the upstream YAML
 * via `bun run sync-catalog`. For v0.1 we hand-author the 7 most common
 * agents to keep the build pipeline simple.
 */
import type { AgentId, McpTransport } from '../types.ts'

export type EmitterId = 'json' | 'toml-codex'

export interface JsonEmitterConfig {
  /** Top-level key under which entries live. */
  parentKey: 'mcpServers' | 'servers' | 'context_servers'
  /**
   * Static fields merged into every emitted entry value. Examples:
   * - Zed: { source: 'custom', enabled: true }
   * Prefer `transportTagKey` over `injectFields` for transport-tag
   * variants ('stdio' / 'sse' / 'http') so the tag tracks spec.transport
   * instead of being pinned to one value.
   */
  injectFields?: Record<string, unknown>
  /**
   * When set, the emitter writes `{ [transportTagKey]: spec.transport }`
   * into the entry alongside the base shape. Used by clients whose
   * parsers require an explicit transport tag (VS Code's `type` field,
   * Claude Code's project-scope `.mcp.json`). Independent of
   * `supportedTransports` (a tag is still written even if only one
   * transport is allowed; in that case the tag is always that one
   * value).
   */
  transportTagKey?: 'type' | 'transport'
}

export interface TomlCodexEmitterConfig {
  /** Top-level table that holds the server map. */
  tableKey: 'mcp_servers'
}

export type EmitterConfig = JsonEmitterConfig | TomlCodexEmitterConfig

export interface CatalogEntry {
  id: AgentId
  displayName: string
  /**
   * Paths that, if any one exists, signal the agent is installed. Env
   * vars use $VAR syntax (no braces). Resolved per-OS at runtime.
   */
  installCheckPaths: {
    darwin?: string[]
    linux?: string[]
    win32?: string[]
  }
  /** Per-OS list of candidate system config paths. Tried in order. */
  systemPaths: {
    darwin?: string[]
    linux?: string[]
    win32?: string[]
  }
  /** Path relative to projectRoot, when project-scope is supported. */
  projectFile?: string
  emitterId: EmitterId
  emitterConfig: EmitterConfig
  /**
   * Transports this agent's config file actually accepts at system
   * scope. Omitted means the full set ['stdio', 'sse', 'http']. Agents
   * whose parser only validates stdio (claude-desktop, codex) declare
   * ['stdio'] and link() throws UnsupportedTransportError for non-stdio
   * specs before any file write.
   */
  supportedTransports?: ReadonlyArray<McpTransport>
  /**
   * When project scope (`<projectRoot>/<projectFile>`) writes a different
   * emitter config than system scope, this is the override. Today only
   * claude-code uses this: system scope (`~/.claude.json`) accepts all
   * three transports with no `type` tag, while project scope (`.mcp.json`)
   * is stdio-only and writes `type: "stdio"`. When omitted, project
   * scope reuses `emitterConfig` and `supportedTransports`.
   */
  projectEmitterConfig?: EmitterConfig
  /**
   * Same shape as `supportedTransports` but for the project scope.
   * Omitted means inherit from `supportedTransports`.
   */
  projectSupportedTransports?: ReadonlyArray<McpTransport>
}

/** v0.1 catalog — seven agents. */
export const CATALOG: readonly CatalogEntry[] = [
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    installCheckPaths: {
      darwin: ['$HOME/.claude'],
      linux: ['$HOME/.claude'],
      win32: ['$USERPROFILE\\.claude'],
    },
    systemPaths: {
      darwin: ['$CLAUDE_CONFIG_DIR/.claude.json', '$HOME/.claude.json'],
      linux: ['$CLAUDE_CONFIG_DIR/.claude.json', '$HOME/.claude.json'],
      win32: ['$CLAUDE_CONFIG_DIR\\.claude.json', '$USERPROFILE\\.claude.json'],
    },
    projectFile: '.mcp.json',
    emitterId: 'json',
    emitterConfig: { parentKey: 'mcpServers' },
    // Newer Claude Code rejects entries in `.mcp.json` (project scope)
    // that omit a `type: "stdio"` tag, so the project emitter writes it
    // unconditionally and the scope is locked to stdio. Mirrors upstream
    // docker/mcp-gateway:
    //   set: .mcpServers[$NAME] = $JSON+{"type":"stdio"}
    // System scope (`~/.claude.json`) keeps the looser shape because
    // it does still accept all three transports.
    projectEmitterConfig: {
      parentKey: 'mcpServers',
      transportTagKey: 'type',
    },
    projectSupportedTransports: ['stdio'],
  },
  {
    id: 'claude-desktop',
    displayName: 'Claude Desktop',
    installCheckPaths: {
      darwin: ['/Applications/Claude.app'],
      linux: ['$HOME/.config/claude'],
      win32: ['$APPDATA\\Claude'],
    },
    systemPaths: {
      darwin: [
        '$HOME/Library/Application Support/Claude/claude_desktop_config.json',
      ],
      linux: ['$HOME/.config/claude/claude_desktop_config.json'],
      win32: ['$APPDATA\\Claude\\claude_desktop_config.json'],
    },
    emitterId: 'json',
    emitterConfig: { parentKey: 'mcpServers' },
    // Claude Desktop's parser only validates stdio entries. Entries
    // without a `command` field are reported as "not a valid MCP server
    // configuration and were skipped" on app launch. Mirrors upstream
    // docker/mcp-gateway, whose write path (MCPServerSTDIO) is stdio-only
    // by Go type.
    supportedTransports: ['stdio'],
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    installCheckPaths: {
      darwin: ['/Applications/Cursor.app'],
      linux: ['$HOME/.config/Cursor'],
      win32: ['$APPDATA\\Cursor'],
    },
    systemPaths: {
      darwin: ['$HOME/.cursor/mcp.json'],
      linux: ['$HOME/.cursor/mcp.json'],
      win32: ['$USERPROFILE\\.cursor\\mcp.json'],
    },
    projectFile: '.cursor/mcp.json',
    emitterId: 'json',
    emitterConfig: { parentKey: 'mcpServers' },
  },
  {
    id: 'vscode',
    displayName: 'Visual Studio Code',
    installCheckPaths: {
      darwin: ['/Applications/Visual Studio Code.app'],
      linux: ['$HOME/.config/Code'],
      win32: ['$APPDATA\\Code'],
    },
    systemPaths: {
      darwin: ['$HOME/Library/Application Support/Code/User/mcp.json'],
      linux: ['$HOME/.config/Code/User/mcp.json'],
      win32: ['$APPDATA\\Code\\User\\mcp.json'],
    },
    projectFile: '.vscode/mcp.json',
    emitterId: 'json',
    // VS Code's parser requires an explicit `type` tag on every entry.
    // Track spec.transport (stdio / sse / http) instead of pinning to
    // 'stdio'; upstream docker/mcp-gateway hardcodes 'stdio' because
    // their write surface is stdio-only by Go type, but VS Code itself
    // accepts all three when tagged correctly.
    emitterConfig: { parentKey: 'servers', transportTagKey: 'type' },
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    installCheckPaths: {
      darwin: ['$HOME/.gemini'],
      linux: ['$HOME/.gemini'],
      win32: ['$USERPROFILE\\.gemini'],
    },
    systemPaths: {
      darwin: ['$HOME/.gemini/settings.json'],
      linux: ['$HOME/.gemini/settings.json'],
      win32: ['$USERPROFILE\\.gemini\\settings.json'],
    },
    emitterId: 'json',
    emitterConfig: { parentKey: 'mcpServers' },
  },
  {
    id: 'codex',
    displayName: 'Codex',
    installCheckPaths: {
      darwin: ['$HOME/.codex'],
      linux: ['$HOME/.codex'],
      win32: ['$USERPROFILE\\.codex'],
    },
    systemPaths: {
      darwin: ['$HOME/.codex/config.toml'],
      linux: ['$HOME/.codex/config.toml'],
      win32: ['$USERPROFILE\\.codex\\config.toml'],
    },
    // Codex has no project-scope file in the upstream catalog.
    emitterId: 'toml-codex',
    emitterConfig: { tableKey: 'mcp_servers' },
    // `~/.codex/config.toml` has no schema upstream that accepts a
    // remote-url shape for an MCP entry. The TOML emitter only knows
    // the stdio shape (command, args, env). Reject non-stdio at link
    // time rather than letting the serializer surprise the caller.
    supportedTransports: ['stdio'],
  },
  {
    id: 'zed',
    displayName: 'Zed',
    installCheckPaths: {
      darwin: ['$HOME/.config/zed'],
      linux: ['$HOME/.config/zed'],
      win32: ['$USERPROFILE\\.config\\zed'],
    },
    systemPaths: {
      darwin: ['$HOME/.config/zed/settings.json'],
      linux: ['$HOME/.config/zed/settings.json'],
      win32: ['$USERPROFILE\\.config\\zed\\settings.json'],
    },
    emitterId: 'json',
    emitterConfig: {
      parentKey: 'context_servers',
      injectFields: { source: 'custom', enabled: true },
    },
  },
]

// Null-prototype map: defense-in-depth so that `hasOwn` / `in` lookups
// can't accidentally hit inherited Object.prototype keys.
export const CATALOG_BY_ID: Record<AgentId, CatalogEntry> = CATALOG.reduce(
  (acc, entry) => {
    acc[entry.id] = entry
    return acc
  },
  Object.create(null) as Record<AgentId, CatalogEntry>,
)
