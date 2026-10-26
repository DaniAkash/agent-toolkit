/**
 * Populated MCP client configuration catalog.
 *
 * 23 entries covering the full Smithery client roster. Every entry has:
 *   - `sources.firstParty`: URL to the client's own MCP documentation
 *     (primary source).
 *   - `sources.smithery`: URL to smithery-ai/cli src/config/clients.ts
 *     (corroborating cross-check; AGPL-3.0 design reference).
 *   - `sources.verified`: ISO date of last research/verification pass.
 *
 * Refresh cadence: the validator rejects any entry whose verified date
 * is more than 365 days old. When you touch an entry, bump its date.
 *
 * License: MIT. Interfaces and populated data authored by us. Smithery
 * is a design reference for the shape space and a corroborating source
 * for per-client values; no code copied verbatim. See
 * THIRD_PARTY_NOTICES.md.
 */

import { PROJECT_ROOT_TOKEN } from '../emitters/shape.ts'
import type { ClientConfig, HttpShape, StdioShape } from './types.ts'

// There is deliberately no shared VERIFIED constant any more. One date for
// every entry said only when the last sweep ran, which let an entry nobody
// re-checked inherit someone else's confidence. Each entry now carries the
// date it was actually looked at, alongside `verifiedAgainst` when a client
// release or source revision was established.
const SMITHERY_URL =
  'https://github.com/smithery-ai/cli/blob/main/src/config/clients.ts'

// -------------------------------------------------------------------
// Popular, well-documented clients
// -------------------------------------------------------------------

export const claudeDesktop: ClientConfig = {
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
  format: 'json',
  supportedTransports: { system: ['stdio'] },
  stdio: { topLevelKey: 'mcpServers' },
  sources: {
    firstParty:
      'https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers',
    smithery: SMITHERY_URL,
    notes:
      'Claude Desktop parses claude_desktop_config.json strictly. Entries without a `command` field are silently dropped on app launch. Hosted remote connectors are configured via the Claude Desktop UI, not this file.',
    verified: '2026-10-26',
    verifiedAgainst: 'claude-desktop@3.6556.2',
  },
}

export const claudeCode: ClientConfig = {
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
  format: 'json',
  supportedTransports: {
    system: ['stdio', 'sse', 'http'],
    project: ['stdio'],
  },
  stdio: { topLevelKey: 'mcpServers' },
  http: {
    tagKey: 'type',
    tagValue: 'http',
    sseTagValue: 'sse',
    supportsOAuth: true,
  },
  project: {
    stdio: { topLevelKey: 'mcpServers', tagKey: 'type', tagValue: 'stdio' },
  },
  // `claude mcp add -s local`, which is Claude Code's DEFAULT scope. It
  // shares ~/.claude.json with the user/system scope and is told apart
  // only by the container: projects.<cwd>.mcpServers. A single key cannot
  // address that, which is why StdioShape grew `containerPath`.
  local: {
    stdio: {
      topLevelKey: 'projects',
      containerPath: ['projects', PROJECT_ROOT_TOKEN, 'mcpServers'],
    },
    http: {
      tagKey: 'type',
      tagValue: 'http',
      sseTagValue: 'sse',
      supportsOAuth: true,
    },
  },
  sources: {
    firstParty: 'https://code.claude.com/docs/en/mcp',
    smithery: SMITHERY_URL,
    notes:
      'HTTP and SSE entries in ~/.claude.json require an explicit `type` field ("http", "sse", or "ws") or Claude Code emits a "url but no type" parse warning and skips the entry on launch. Stdio entries are accepted with or without a type tag. Project scope (.mcp.json) writes an explicit type: stdio tag per Claude Code project-scope docs. Three scopes, two of which share ~/.claude.json: `claude mcp add -s <local|user|project>`. `system` here is what the CLI calls `user`; `local` is the CLI default and writes projects.<cwd>.mcpServers in the same file, which is why this entry declares a containerPath.',
    verified: '2026-10-26',
    verifiedAgainst: 'claude-code@2.0 (mcp add --help)',
  },
}

export const cursor: ClientConfig = {
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
  format: 'json',
  supportedTransports: {
    system: ['stdio', 'sse', 'http'],
    project: ['stdio', 'sse', 'http'],
  },
  stdio: { topLevelKey: 'mcpServers' },
  http: { tagKey: 'type', tagValue: 'http', supportsOAuth: true },
  project: {
    stdio: { topLevelKey: 'mcpServers' },
    http: { tagKey: 'type', tagValue: 'http', supportsOAuth: true },
  },
  sources: {
    firstParty: 'https://cursor.com/docs/mcp',
    smithery: SMITHERY_URL,
    verified: '2026-10-26',
    verifiedAgainst: 'cursor@3.23.23',
  },
}

const VSCODE_STDIO = {
  topLevelKey: 'servers',
  tagKey: 'type',
  tagValue: 'stdio',
} as const
const VSCODE_HTTP = {
  tagKey: 'type',
  tagValue: 'http',
  supportsOAuth: true,
} as const

export const vscode: ClientConfig = {
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
  format: 'json',
  supportedTransports: {
    system: ['stdio', 'sse', 'http'],
    project: ['stdio', 'sse', 'http'],
  },
  stdio: VSCODE_STDIO,
  http: VSCODE_HTTP,
  project: { stdio: VSCODE_STDIO, http: VSCODE_HTTP },
  sources: {
    firstParty:
      'https://code.visualstudio.com/docs/agent-customization/mcp-servers',
    smithery: SMITHERY_URL,
    verified: '2026-10-26',
    verifiedAgainst: 'vscode@1.143.1',
  },
}

export const vscodeInsiders: ClientConfig = {
  ...vscode,
  id: 'vscode-insiders',
  displayName: 'VS Code Insiders',
  installCheckPaths: {
    darwin: ['/Applications/Visual Studio Code - Insiders.app'],
    linux: ['$HOME/.config/Code - Insiders'],
    win32: ['$APPDATA\\Code - Insiders'],
  },
  systemPaths: {
    darwin: ['$HOME/Library/Application Support/Code - Insiders/User/mcp.json'],
    linux: ['$HOME/.config/Code - Insiders/User/mcp.json'],
    win32: ['$APPDATA\\Code - Insiders\\User\\mcp.json'],
  },
  sources: {
    firstParty:
      'https://code.visualstudio.com/docs/agent-customization/mcp-servers',
    smithery: SMITHERY_URL,
    notes:
      'Same shape as the stable VS Code channel; only the config directory differs.',
    verified: '2026-10-26',
  },
}

export const gemini: ClientConfig = {
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
  format: 'json',
  supportedTransports: { system: ['stdio', 'sse', 'http'] },
  stdio: { topLevelKey: 'mcpServers' },
  http: { tagKey: 'type', tagValue: 'http', supportsOAuth: true },
  sources: {
    firstParty:
      'https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md',
    smithery: SMITHERY_URL,
    verified: '2026-10-26',
    verifiedAgainst: 'gemini-cli@0.46.0',
  },
}

export const codex: ClientConfig = {
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
  format: 'toml',
  supportedTransports: { system: ['stdio', 'http'] },
  stdio: { topLevelKey: 'mcp_servers' },
  http: { headerField: 'http_headers', supportsOAuth: true },
  sources: {
    firstParty: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
    smithery: SMITHERY_URL,
    notes:
      'TOML config. Streamable-HTTP entries carry `url`, optional `bearer_token_env_var`, `http_headers`, `env_http_headers`. SSE is not parsed.',
    verified: '2026-10-26',
    verifiedAgainst: 'codex-cli@0.164.0',
  },
}

export const zed: ClientConfig = {
  id: 'zed',
  displayName: 'Zed',
  installCheckPaths: {
    darwin: ['$HOME/.config/zed'],
    linux: ['$HOME/.config/zed'],
    win32: ['$APPDATA\\Zed'],
  },
  systemPaths: {
    darwin: ['$HOME/.config/zed/settings.json'],
    linux: ['$HOME/.config/zed/settings.json'],
    win32: ['$APPDATA\\Zed\\settings.json'],
  },
  format: 'json',
  supportedTransports: { system: ['stdio', 'sse', 'http'] },
  stdio: {
    topLevelKey: 'context_servers',
    injects: { source: 'custom', enabled: true },
  },
  http: {
    injects: { source: 'custom', enabled: true },
    supportsOAuth: true,
  },
  sources: {
    firstParty: 'https://zed.dev/docs/ai/mcp',
    smithery: SMITHERY_URL,
    notes:
      'Zed calls them "context_servers". The block sits alongside other settings, so writes are non-destructive under that key.',
    verified: '2026-10-26',
    verifiedAgainst: 'zed@1.25.3',
  },
}

// -------------------------------------------------------------------
// Additional clients from Smithery's full roster
// -------------------------------------------------------------------

export const cline: ClientConfig = {
  id: 'cline',
  displayName: 'Cline',
  installCheckPaths: {
    darwin: [
      '$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev',
    ],
    linux: ['$HOME/.config/Code/User/globalStorage/saoudrizwan.claude-dev'],
    win32: ['$APPDATA\\Code\\User\\globalStorage\\saoudrizwan.claude-dev'],
  },
  systemPaths: {
    darwin: [
      '$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
    ],
    linux: [
      '$HOME/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
    ],
    win32: [
      '$APPDATA\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\settings\\cline_mcp_settings.json',
    ],
  },
  format: 'json',
  supportedTransports: { system: ['stdio', 'http'] },
  stdio: { topLevelKey: 'mcpServers' },
  http: {
    tagKey: 'type',
    tagValue: 'streamableHttp',
    supportsOAuth: true,
  },
  sources: {
    firstParty: 'https://docs.cline.bot/mcp/mcp-overview',
    smithery: SMITHERY_URL,
    notes:
      'Cline uses `type: "streamableHttp"` (camelCase) for remote HTTP, distinct from Kiro\'s `streamable-http`.',
    verified: '2026-10-26',
  },
}

export const opencode: ClientConfig = {
  id: 'opencode',
  displayName: 'OpenCode',
  installCheckPaths: {
    // `$HOME/.local/share/opencode` is OpenCode's OAuth token store
    // (per its docs at https://opencode.ai/docs/mcp-servers/). It
    // exists as soon as the user has authenticated any OAuth MCP
    // server or run the OpenCode installer, even before they create
    // their global `opencode.json`.
    darwin: [
      '$XDG_CONFIG_HOME/opencode',
      '$HOME/.config/opencode',
      '$HOME/.opencode',
      '$HOME/.local/share/opencode',
    ],
    linux: [
      '$XDG_CONFIG_HOME/opencode',
      '$HOME/.config/opencode',
      '$HOME/.opencode',
      '$HOME/.local/share/opencode',
    ],
    win32: [
      '$USERPROFILE\\.config\\opencode',
      '$USERPROFILE\\.opencode',
      '$USERPROFILE\\.local\\share\\opencode',
    ],
  },
  systemPaths: {
    darwin: [
      '$XDG_CONFIG_HOME/opencode/opencode.json',
      '$HOME/.config/opencode/opencode.json',
      '$XDG_CONFIG_HOME/opencode/opencode.jsonc',
      '$HOME/.config/opencode/opencode.jsonc',
      '$HOME/.opencode/opencode.jsonc',
    ],
    linux: [
      '$XDG_CONFIG_HOME/opencode/opencode.json',
      '$HOME/.config/opencode/opencode.json',
      '$XDG_CONFIG_HOME/opencode/opencode.jsonc',
      '$HOME/.config/opencode/opencode.jsonc',
      '$HOME/.opencode/opencode.jsonc',
    ],
    win32: [
      '$USERPROFILE\\.config\\opencode\\opencode.json',
      '$USERPROFILE\\.config\\opencode\\opencode.jsonc',
      '$USERPROFILE\\.opencode\\opencode.jsonc',
    ],
  },
  format: 'jsonc',
  supportedTransports: { system: ['stdio', 'sse', 'http'] },
  stdio: {
    topLevelKey: 'mcp',
    envField: 'environment',
    commandAsArray: true,
    injects: { type: 'local', enabled: true },
  },
  http: {
    tagKey: 'type',
    tagValue: 'remote',
    injects: { enabled: true },
    supportsOAuth: true,
  },
  sources: {
    firstParty: 'https://opencode.ai/docs/mcp-servers/',
    smithery: SMITHERY_URL,
    notes:
      'Command written as a single array of [command, ...args] under `command`. `env` renamed to `environment`. Both stdio and remote entries carry a `type` field (`local` vs `remote`). OpenCode 1.x stores its global config at $XDG_CONFIG_HOME/opencode/ (falling back to ~/.config/opencode/) as `opencode.json`; installCheckPaths also list ~/.local/share/opencode (the OAuth token store, created before the config file exists) and legacy ~/.opencode/. Detection order prefers the XDG/.config locations to avoid missing fresh installs. An unreleased V2 nests servers under `mcp.servers` and inverts `enabled` into `disabled`; V2 is not on npm, homebrew or GitHub releases, so this entry targets the released 1.x line. `mcp.servers` with `disabled` is already read by 1.19.4, so the eventual move is a one-line change to containerPath plus the injected flag.',
    verified: '2026-10-26',
    verifiedAgainst: 'opencode@1.19.4',
  },
}

export const goose: ClientConfig = {
  id: 'goose',
  displayName: 'Goose',
  installCheckPaths: {
    darwin: ['$HOME/.config/goose'],
    linux: ['$HOME/.config/goose'],
    win32: ['$APPDATA\\Block\\goose'],
  },
  systemPaths: {
    darwin: ['$HOME/.config/goose/config.yaml'],
    linux: ['$HOME/.config/goose/config.yaml'],
    win32: ['$APPDATA\\Block\\goose\\config\\config.yaml'],
  },
  format: 'yaml',
  supportedTransports: { system: ['stdio', 'http'] },
  stdio: {
    topLevelKey: 'extensions',
    commandField: 'cmd',
    envField: 'envs',
    tagKey: 'type',
    tagValue: 'stdio',
    keyTransform: 'simpleName',
  },
  http: { tagKey: 'type', tagValue: 'http', supportsOAuth: true },
  sources: {
    firstParty: 'https://goose-docs.ai/docs/getting-started/using-extensions/',
    smithery: SMITHERY_URL,
    notes:
      "Extension keys are letters-only lowercase (Goose's `simpleName` transform). Command renamed to `cmd`, env renamed to `envs`. Docker's upstream config also hardcodes several static fields (`bundled: null`, `description`, `enabled: true`); we do not emit those unless a consumer asks.",
    verified: '2026-10-26',
  },
}

export const kiro: ClientConfig = {
  id: 'kiro',
  displayName: 'Kiro',
  installCheckPaths: {
    darwin: ['$HOME/.kiro'],
    linux: ['$HOME/.kiro'],
    win32: ['$USERPROFILE\\.kiro'],
  },
  systemPaths: {
    darwin: ['$HOME/.kiro/settings/mcp.json'],
    linux: ['$HOME/.kiro/settings/mcp.json'],
    win32: ['$USERPROFILE\\.kiro\\settings\\mcp.json'],
  },
  projectFile: '.kiro/settings/mcp.json',
  format: 'json',
  supportedTransports: {
    system: ['stdio', 'http'],
    project: ['stdio', 'http'],
  },
  stdio: { topLevelKey: 'mcpServers' },
  http: {
    tagKey: 'type',
    tagValue: 'streamable-http',
    supportsOAuth: true,
  },
  project: {
    stdio: { topLevelKey: 'mcpServers' },
    http: {
      tagKey: 'type',
      tagValue: 'streamable-http',
      supportsOAuth: true,
    },
  },
  sources: {
    firstParty: 'https://kiro.dev/docs/mcp/',
    smithery: SMITHERY_URL,
    notes:
      'Kiro uses `type: "streamable-http"` (kebab-case), the spec-canonical form.',
    verified: '2026-10-26',
    verifiedAgainst: 'kiro@installed-2026-10-26',
  },
}

export const windsurf: ClientConfig = {
  id: 'windsurf',
  displayName: 'Windsurf',
  installCheckPaths: {
    darwin: ['$HOME/.codeium/windsurf'],
    linux: ['$HOME/.codeium/windsurf'],
    win32: ['$USERPROFILE\\.codeium\\windsurf'],
  },
  systemPaths: {
    darwin: ['$HOME/.codeium/windsurf/mcp_config.json'],
    linux: ['$HOME/.codeium/windsurf/mcp_config.json'],
    win32: ['$USERPROFILE\\.codeium\\windsurf\\mcp_config.json'],
  },
  format: 'json',
  supportedTransports: { system: ['stdio', 'http'] },
  stdio: { topLevelKey: 'mcpServers' },
  http: {
    urlField: 'serverUrl',
    supportsOAuth: true,
  },
  sources: {
    firstParty: 'https://docs.devin.ai/windsurf/plugins/cascade/mcp',
    smithery: SMITHERY_URL,
    notes:
      'Windsurf calls the URL field `serverUrl` for remote entries, not the default `url`.',
    verified: '2026-10-26',
  },
}

export const witsy: ClientConfig = {
  id: 'witsy',
  displayName: 'Witsy',
  installCheckPaths: {
    darwin: ['$HOME/Library/Application Support/Witsy'],
    linux: ['$HOME/.config/Witsy'],
    win32: ['$APPDATA\\Witsy'],
  },
  systemPaths: {
    darwin: ['$HOME/Library/Application Support/Witsy/settings.json'],
    linux: ['$HOME/.config/Witsy/settings.json'],
    win32: ['$APPDATA\\Witsy\\settings.json'],
  },
  format: 'json',
  supportedTransports: { system: ['stdio'] },
  stdio: { topLevelKey: 'mcpServers' },
  sources: {
    firstParty: 'https://github.com/Kochava-Studios/witsy',
    smithery: SMITHERY_URL,
    notes:
      'Verified from source. `src/main/config.ts` puts settings at Electron\'s `app.getPath("userData")/settings.json`, which is ~/Library/Application Support/Witsy/settings.json on macOS. `src/main/mcp.ts` getServers() reads two places and merges them: its own `mcp.servers` array, and a TOP-LEVEL `mcpServers` map whose entries it reads as `command`, `args` and `cwd`. The top-level map is the one this catalog writes. The citation moved: nbonamy/witsy is now a stub whose README points here.',
    verified: '2026-10-26',
    verifiedAgainst: 'Kochava-Studios/witsy@main (main/mcp.ts)',
  },
}

export const enconvo: ClientConfig = {
  id: 'enconvo',
  displayName: 'Enconvo',
  installCheckPaths: {
    darwin: ['$HOME/.config/enconvo'],
    linux: ['$HOME/.config/enconvo'],
    win32: ['$USERPROFILE\\.config\\enconvo'],
  },
  systemPaths: {
    darwin: ['$HOME/.config/enconvo/mcp_config.json'],
    linux: ['$HOME/.config/enconvo/mcp_config.json'],
    win32: ['$USERPROFILE\\.config\\enconvo\\mcp_config.json'],
  },
  format: 'json',
  supportedTransports: { system: ['stdio'] },
  stdio: { topLevelKey: 'mcpServers' },
  sources: {
    firstParty: 'https://www.enconvo.com/',
    smithery: SMITHERY_URL,
    verified: '2026-10-26',
  },
}

export const roocode: ClientConfig = {
  id: 'roocode',
  displayName: 'Roo Code',
  installCheckPaths: {
    darwin: [
      '$HOME/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline',
    ],
    linux: ['$HOME/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline'],
    win32: ['$APPDATA\\Code\\User\\globalStorage\\rooveterinaryinc.roo-cline'],
  },
  systemPaths: {
    darwin: [
      '$HOME/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json',
    ],
    linux: [
      '$HOME/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json',
    ],
    win32: [
      '$APPDATA\\Code\\User\\globalStorage\\rooveterinaryinc.roo-cline\\settings\\mcp_settings.json',
    ],
  },
  format: 'json',
  supportedTransports: { system: ['stdio'] },
  stdio: { topLevelKey: 'mcpServers' },
  sources: {
    firstParty: 'https://roocodeinc.github.io/Roo-Code/features/mcp/overview/',
    smithery: SMITHERY_URL,
    notes:
      "Roo Code is a VS Code extension (fork of Cline). MCP settings live in the extension's globalStorage folder.",
    verified: '2026-10-26',
  },
}

export const boltai: ClientConfig = {
  id: 'boltai',
  displayName: 'BoltAI',
  installCheckPaths: {
    darwin: ['$HOME/.boltai'],
    linux: ['$HOME/.boltai'],
    win32: ['$USERPROFILE\\.boltai'],
  },
  systemPaths: {
    darwin: ['$HOME/.boltai/mcp.json'],
    linux: ['$HOME/.boltai/mcp.json'],
    win32: ['$USERPROFILE\\.boltai\\mcp.json'],
  },
  format: 'json',
  supportedTransports: { system: ['stdio'] },
  stdio: { topLevelKey: 'mcpServers' },
  sources: {
    firstParty: 'https://docs.boltai.com/docs/plugins/mcp-servers',
    smithery: SMITHERY_URL,
    notes:
      'Verified from first-party docs: "BoltAI stores all configuration in /Users/<user>/.boltai/mcp.json" and "follows the standard MCP configuration convention". Stdio only, confirmed by the FAQ answer that a remote server needs `mcp-remote` to be converted into a local stdio server, so no http shape is declared.',
    verified: '2026-10-26',
    verifiedAgainst: 'boltai@docs-2026-10',
  },
}

export const amazonBedrock: ClientConfig = {
  id: 'amazon-bedrock',
  displayName: 'Amazon Bedrock',
  installCheckPaths: {
    darwin: [
      '/Applications/Amazon Bedrock Client.app',
      '$HOME/mcp_config.json',
    ],
    linux: ['$HOME/mcp_config.json'],
    win32: ['$USERPROFILE\\mcp_config.json'],
  },
  systemPaths: {
    darwin: ['$HOME/mcp_config.json'],
    linux: ['$HOME/mcp_config.json'],
    win32: ['$USERPROFILE\\mcp_config.json'],
  },
  format: 'json',
  supportedTransports: { system: ['stdio'] },
  stdio: { topLevelKey: 'mcpServers' },
  sources: {
    firstParty: 'https://github.com/aws-samples/amazon-bedrock-client-for-mac',
    smithery: SMITHERY_URL,
    notes:
      'PATH CORRECTED from source. Sources/Bedrock/Services/MCP/MCPClientManager.swift getConfigPath() builds `PreferencesStore.shared.defaultDirectory` (empty by default) or else `FileManager.default.homeDirectoryForCurrentUser`, then appends `mcp_config.json`. There is no "Amazon Bedrock Client" directory component anywhere in it, so the previous path was wrong; it matches Smithery\'s roster, the likely origin. A user who sets a default directory moves the file, so a caller honouring that should pass an explicit configPath. MCPConfiguration.swift confirms the root key is `mcpServers`. It also handles a `.http` transport alongside `.stdio`, discriminated by a `transportType` field, but the exact JSON spelling of that field was not established here, so no http shape is declared yet.',
    verified: '2026-10-26',
    verifiedAgainst:
      'amazon-bedrock-client-for-mac@main (MCPClientManager.swift)',
  },
}

export const amazonq: ClientConfig = {
  id: 'amazonq',
  displayName: 'Amazon Q',
  installCheckPaths: {
    darwin: ['$HOME/.aws/amazonq'],
    linux: ['$HOME/.aws/amazonq'],
    win32: ['$USERPROFILE\\.aws\\amazonq'],
  },
  systemPaths: {
    darwin: ['$HOME/.aws/amazonq/mcp.json'],
    linux: ['$HOME/.aws/amazonq/mcp.json'],
    win32: ['$USERPROFILE\\.aws\\amazonq\\mcp.json'],
  },
  format: 'json',
  supportedTransports: { system: ['stdio'] },
  stdio: { topLevelKey: 'mcpServers' },
  sources: {
    firstParty:
      'https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/qdev-mcp.html',
    smithery: SMITHERY_URL,
    notes:
      'CONDITIONAL: ~/.aws/amazonq/mcp.json is the LEGACY location. Per aws/amazon-q-developer-cli docs/agent-format.md it is read only when the active agent sets `useLegacyMcpJson: true`; otherwise Q ignores it and a linked server silently never appears. The current location is the `mcpServers` field inside an agent document, ~/.aws/amazonq/agents/default.json for the IDE or under ~/.aws/amazonq/cli-agents for the CLI. Writing there is not a path change: an agent document also needs `name` and other fields, so creating one from scratch would produce an invalid agent. That makes it a feature (emit an agent document) rather than a catalog edit, which is why the legacy path is still the write target here. Reordering the candidates alone would be worse, since pickConfigPath falls back to the first entry and would create a nameless agent file.',
    verified: '2026-10-26',
    verifiedAgainst: 'amazon-q-developer-cli@main (docs/agent-format.md)',
  },
}

export const librechat: ClientConfig = {
  id: 'librechat',
  displayName: 'LibreChat',
  installCheckPaths: {
    darwin: ['$HOME/LibreChat'],
    linux: ['$HOME/LibreChat'],
    win32: ['$USERPROFILE\\LibreChat'],
  },
  systemPaths: {
    darwin: [
      '$LIBRECHAT_CONFIG_DIR/LibreChat/librechat.yaml',
      '$HOME/LibreChat/librechat.yaml',
    ],
    linux: [
      '$LIBRECHAT_CONFIG_DIR/LibreChat/librechat.yaml',
      '$HOME/LibreChat/librechat.yaml',
    ],
    win32: [
      '$LIBRECHAT_CONFIG_DIR\\LibreChat\\librechat.yaml',
      '$USERPROFILE\\LibreChat\\librechat.yaml',
    ],
  },
  format: 'yaml',
  supportedTransports: { system: ['stdio', 'sse', 'http'] },
  stdio: { topLevelKey: 'mcpServers' },
  http: {
    tagKey: 'type',
    // LibreChat accepts `streamable-http` with `http` as its documented
    // alias, and `sse` as a distinct type. Without sseTagValue an sse spec
    // was written as `type: http`, which is a different transport.
    tagValue: 'http',
    sseTagValue: 'sse',
    supportsOAuth: true,
  },
  sources: {
    firstParty:
      'https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers',
    smithery: SMITHERY_URL,
    notes:
      'YAML config file. mcpServers block accepts stdio (command/args) and remote (url) entries.',
    verified: '2026-10-26',
    verifiedAgainst: 'librechat@docs-2026-10',
  },
}

export const antigravity: ClientConfig = {
  id: 'antigravity',
  displayName: 'Antigravity',
  installCheckPaths: {
    darwin: ['$HOME/.gemini/antigravity'],
    linux: ['$HOME/.gemini/antigravity'],
    win32: ['$USERPROFILE\\.gemini\\antigravity'],
  },
  systemPaths: {
    darwin: ['$HOME/.gemini/config/mcp_config.json'],
    linux: ['$HOME/.gemini/config/mcp_config.json'],
    win32: ['$USERPROFILE\\.gemini\\config\\mcp_config.json'],
  },
  format: 'json',
  supportedTransports: { system: ['stdio', 'http'] },
  stdio: { topLevelKey: 'mcpServers' },
  http: {
    urlField: 'serverUrl',
    supportsOAuth: true,
  },
  sources: {
    firstParty: 'https://antigravity.google/',
    smithery: SMITHERY_URL,
    notes:
      "Google's Antigravity editor. Uses `serverUrl` for remote entries (matches Windsurf's convention). Config file lives at ~/.gemini/config/mcp_config.json; the ~/.gemini/antigravity/ directory is the install fingerprint.",
    verified: '2026-10-26',
    verifiedAgainst: 'antigravity@2.19.1',
  },
}

export const trae: ClientConfig = {
  id: 'trae',
  displayName: 'Trae',
  installCheckPaths: {
    darwin: ['$HOME/Library/Application Support/Trae'],
    linux: ['$HOME/.config/Trae'],
    win32: ['$APPDATA\\Trae'],
  },
  systemPaths: {
    darwin: ['$HOME/Library/Application Support/Trae/User/mcp.json'],
    linux: ['$HOME/.config/Trae/User/mcp.json'],
    win32: ['$APPDATA\\Trae\\User\\mcp.json'],
  },
  projectFile: '.trae/mcp.json',
  format: 'json',
  supportedTransports: { system: ['stdio', 'http'] },
  stdio: { topLevelKey: 'mcpServers' },
  http: { tagKey: 'type', tagValue: 'http', supportsOAuth: true },
  sources: {
    firstParty: 'https://docs.trae.ai/ide/add-mcp-servers',
    smithery: SMITHERY_URL,
    notes:
      'Citation corrected: the previous URL (/ide/model-context-protocol) is a JS-rendered SPA that answers 200 for any path, so a status check could not tell it had moved; the real page is /ide/add-mcp-servers. It documents the `mcpServers` key and a project-scoped file: "Create an mcp.json file in the .trae/ directory under the project root", which is now declared as projectFile. The system path is the app-managed file behind the "Raw Config (JSON)" button.',
    verified: '2026-10-26',
    verifiedAgainst: 'trae@docs-2026-10',
  },
}

// -------------------------------------------------------------------
// Aggregated catalog
// -------------------------------------------------------------------

// GitHub Copilot CLI writes the same shape at both scopes. `tools: ['*']`
// mirrors every first-party example; see the entry's notes for why it is
// emitted rather than left to an undocumented default.
const COPILOT_STDIO: StdioShape = {
  topLevelKey: 'mcpServers',
  tagKey: 'type',
  tagValue: 'local',
  injects: { tools: ['*'] },
}

const COPILOT_HTTP: HttpShape = {
  tagKey: 'type',
  tagValue: 'http',
  sseTagValue: 'sse',
  supportsOAuth: false,
  injects: { tools: ['*'] },
}

export const copilotCli: ClientConfig = {
  id: 'copilot-cli',
  displayName: 'GitHub Copilot CLI',
  installCheckPaths: {
    darwin: ['$HOME/.copilot'],
    linux: ['$HOME/.copilot'],
    win32: ['$USERPROFILE\\.copilot'],
  },
  systemPaths: {
    darwin: ['$HOME/.copilot/mcp-config.json'],
    linux: ['$HOME/.copilot/mcp-config.json'],
    win32: ['$USERPROFILE\\.copilot\\mcp-config.json'],
  },
  projectFile: '.mcp.json',
  format: 'json',
  supportedTransports: {
    system: ['stdio', 'sse', 'http'],
    project: ['stdio', 'sse', 'http'],
  },
  stdio: COPILOT_STDIO,
  http: COPILOT_HTTP,
  project: { stdio: COPILOT_STDIO, http: COPILOT_HTTP },
  sources: {
    firstParty:
      'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers',
    notes:
      'Stdio entries carry `type: "local"`; the docs note "stdio" is accepted as the standard spelling. Remote entries use `type: "http"` (Streamable HTTP) or the deprecated `"sse"`. Project scope reads `.mcp.json` in preference to `.github/mcp.json` when both sit in one directory, so `.mcp.json` is the write target. `tools: ["*"]` is emitted because every first-party JSON example carries it and the docs give `*` as the default only for the interactive form and the `--tools` flag, never for an omitted JSON field. Writing it matches the examples instead of betting on an undocumented default.',
    verified: '2026-10-26',
    verifiedAgainst: 'copilot-cli@docs-2026-10',
  },
}

export const devinCli: ClientConfig = {
  id: 'devin-cli',
  displayName: 'Devin CLI',
  installCheckPaths: {
    darwin: ['$HOME/.config/devin', '$XDG_CONFIG_HOME/devin'],
    linux: ['$XDG_CONFIG_HOME/devin', '$HOME/.config/devin'],
    win32: ['$APPDATA\\devin'],
  },
  systemPaths: {
    darwin: [
      '$XDG_CONFIG_HOME/devin/mcp_config.json',
      '$HOME/.config/devin/mcp_config.json',
    ],
    linux: [
      '$XDG_CONFIG_HOME/devin/mcp_config.json',
      '$HOME/.config/devin/mcp_config.json',
    ],
    win32: ['$APPDATA\\devin\\mcp_config.json'],
  },
  projectFile: '.devin/mcp_config.json',
  format: 'json',
  supportedTransports: {
    system: ['stdio', 'sse', 'http'],
    project: ['stdio', 'sse', 'http'],
  },
  // No type tag on stdio entries: the documented shape is bare
  // command/args/env.
  stdio: { topLevelKey: 'mcpServers' },
  // Devin spells the transport discriminator `transport`, not `type`.
  http: {
    tagKey: 'transport',
    tagValue: 'http',
    sseTagValue: 'sse',
    supportsOAuth: true,
  },
  project: {
    stdio: { topLevelKey: 'mcpServers' },
    http: {
      tagKey: 'transport',
      tagValue: 'http',
      sseTagValue: 'sse',
      supportsOAuth: true,
    },
  },
  sources: {
    firstParty: 'https://docs.devin.ai/cli/extensibility/mcp/configuration',
    notes:
      'Stdio entries are bare command/args/env with no type tag. Remote entries use `transport` ("http" default, or "sse") rather than `type`, plus `headers` and oauthClientId / oauthClientSecret / oauthResource. A `disabled` boolean skips a server. `.devin/mcp_config.local.json` is a gitignored personal override this library does not write.',
    verified: '2026-10-26',
    verifiedAgainst: 'devin-cli@docs-2026-10',
  },
}

// The Cline CLI, distinct from the `cline` entry above: same product,
// different config file. The VS Code extension keeps its settings under
// the editor's globalStorage; the CLI keeps its own under ~/.cline/data.
// Writing to the wrong one puts an entry in a file the user's tool never
// reads, which is why these are two catalog entries rather than extra
// paths on one.
export const clineCli: ClientConfig = {
  id: 'cline-cli',
  displayName: 'Cline CLI',
  installCheckPaths: {
    darwin: ['$HOME/.cline'],
    linux: ['$HOME/.cline'],
    win32: ['$USERPROFILE\\.cline'],
  },
  systemPaths: {
    darwin: ['$HOME/.cline/data/settings/cline_mcp_settings.json'],
    linux: ['$HOME/.cline/data/settings/cline_mcp_settings.json'],
    win32: ['$USERPROFILE\\.cline\\data\\settings\\cline_mcp_settings.json'],
  },
  format: 'json',
  supportedTransports: { system: ['stdio', 'http'] },
  stdio: { topLevelKey: 'mcpServers' },
  http: {
    tagKey: 'type',
    tagValue: 'streamableHttp',
    supportsOAuth: true,
  },
  sources: {
    firstParty: 'https://docs.cline.bot/mcp/mcp-overview',
    notes:
      'Path read from upstream source rather than documentation: sdk/packages/shared/src/storage/paths.ts resolves it as CLINE_MCP_SETTINGS_PATH, else join(CLINE_DATA_DIR ?? join(CLINE_DIR ?? ~/.cline, "data"), "settings", "cline_mcp_settings.json"). Three env vars can move it, so a caller honouring them should pass an explicit configPath. Secondary sources claim ~/.cline/mcp.json; the source does not support that. Entry shape matches the `cline` extension entry, including `type: "streamableHttp"` for remote.',
    verified: '2026-10-26',
    verifiedAgainst: 'cline/cline@main (storage/paths.ts)',
  },
}

export const CATALOG: ReadonlyArray<ClientConfig> = [
  amazonBedrock,
  amazonq,
  antigravity,
  boltai,
  claudeCode,
  claudeDesktop,
  cline,
  clineCli,
  codex,
  copilotCli,
  cursor,
  devinCli,
  enconvo,
  gemini,
  goose,
  kiro,
  librechat,
  opencode,
  roocode,
  trae,
  vscode,
  vscodeInsiders,
  windsurf,
  witsy,
  zed,
]

type CatalogById = { readonly [K in ClientConfig['id']]: ClientConfig }

export const CATALOG_BY_ID: CatalogById = CATALOG.reduce(
  (acc, entry) => Object.assign(acc, { [entry.id]: entry }),
  Object.create(null) as CatalogById,
)
