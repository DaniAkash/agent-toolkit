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
import type { AgentId } from '../types.ts'

export type EmitterId = 'json' | 'toml-codex'

export interface JsonEmitterConfig {
  /** Top-level key under which entries live. */
  parentKey: 'mcpServers' | 'servers' | 'context_servers'
  /**
   * Fields merged into every emitted entry value. Examples:
   * - VS Code: { type: 'stdio' }
   * - Zed: { source: 'custom', enabled: true }
   */
  injectFields?: Record<string, unknown>
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
    emitterConfig: { parentKey: 'servers', injectFields: { type: 'stdio' } },
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
