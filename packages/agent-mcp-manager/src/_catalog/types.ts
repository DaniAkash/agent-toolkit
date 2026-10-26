/**
 * Hand-authored MCP client configuration catalog.
 *
 * Every published client is one `ClientConfig` value. Data lives in
 * `client-configs.ts`; interpretation lives in the emitters. Sources
 * were researched from each client's first-party MCP docs, cross-
 * checked against smithery-ai/cli (AGPL-3.0, design reference only).
 * See `THIRD_PARTY_NOTICES.md` for the Smithery disclosure.
 *
 * Schema pattern (interfaces + shape space) is informed by Smithery's
 * `src/config/clients.ts`. Interfaces and populated data are authored
 * by us under MIT; no source code from Smithery is incorporated.
 *
 * Every entry is written as a config file. Smithery splits its roster in
 * two and shells out to the client's own CLI for five of them
 * (`claude mcp add`, `code --add-mcp`, `gemini mcp add`, `codex mcp add`).
 * That is an attractive idea, since the client owns its own schema and
 * can never drift from it, and it is deliberately not adopted here.
 *
 * The reason is structural rather than a matter of taste. `FsOp` is
 * `writeFile | removeFile`, and the invariant stated on `planner/types.ts`
 * is that a planner call cannot lie about what it would do: a plan is a
 * list of file writes a caller can inspect, diff and refuse before
 * anything happens. An `execCommand` op would put a hole in that, because
 * the summary could no longer say what the file will contain, only which
 * subprocess it intends to run. It would also pull process spawning, PATH
 * resolution, exit-code handling and per-platform shell quoting into a
 * package whose failure modes are all "which bytes go where".
 *
 * The cost of writing files is real: a client can change its schema under
 * us. The answer is `sources.verified` plus `verifiedAgainst` and the
 * validator's freshness window, which is a weaker guarantee than
 * delegation but a far smaller blast radius. Those five CLIs are still
 * useful as a correctness oracle; `claude mcp add --help` and
 * `codex mcp add --help` document the accepted field names, so a
 * re-verification pass should read them rather than a docs site.
 *
 * If delegation is ever wanted, it belongs behind its own entry point
 * with its own documented caveat, not as a new arm on `FsOp`.
 */

import type { McpTransport } from '../types.ts'

/** Union of every client id we ship a config for. */
export type ClientId =
  | 'claude-desktop'
  | 'claude-code'
  | 'cursor'
  | 'vscode'
  | 'vscode-insiders'
  | 'gemini'
  | 'codex'
  | 'zed'
  | 'cline'
  | 'opencode'
  | 'goose'
  | 'kiro'
  | 'windsurf'
  | 'witsy'
  | 'enconvo'
  | 'roocode'
  | 'boltai'
  | 'amazon-bedrock'
  | 'amazonq'
  | 'librechat'
  | 'antigravity'
  | 'trae'
  | 'copilot-cli'
  | 'devin-cli'
  | 'cline-cli'

export interface PerOsPaths {
  darwin?: string[]
  linux?: string[]
  win32?: string[]
}

export type ConfigFormat = 'json' | 'jsonc' | 'yaml' | 'toml'

export interface StdioShape {
  /** Object key that holds the entry map. Examples: 'mcpServers', 'servers', 'mcp', 'context_servers', 'extensions'. */
  topLevelKey: string
  /**
   * Full path to the entry map, when it is nested deeper than one key.
   * Defaults to `[topLevelKey]`. The literal segment `'{projectRoot}'` is
   * substituted with the caller's project root, which is what lets Claude
   * Code's `local` scope address `projects.<root>.mcpServers` in the same
   * file its `system` scope writes to.
   */
  containerPath?: readonly string[]
  /** Field name for the executable command. Default 'command'. Goose uses 'cmd'. */
  commandField?: string
  /** Field name for the args array. Default 'args'. */
  argsField?: string
  /** Field name for the env-var map. Default 'env'. Goose uses 'envs'. OpenCode uses 'environment'. */
  envField?: string
  /**
   * When true, emit command + args as a single array under the command
   * field (e.g. `command: [<command>, ...<args>]`). OpenCode does this.
   */
  commandAsArray?: boolean
  /** When set, write `{ [tagKey]: tagValue }` alongside the base shape. */
  tagKey?: 'type' | 'transport'
  /** Value written under `tagKey`. Common: 'stdio' or 'local'. */
  tagValue?: string
  /** Static fields merged into every stdio entry (e.g. Zed's `source: 'custom', enabled: true`). */
  injects?: Record<string, unknown>
  /**
   * When set, transform the caller-supplied server name before using it
   * as the entry key. `'simpleName'` matches Docker/Goose semantics
   * (lowercase, letters only: `MCP_DOCKER` -> `mcpdocker`).
   */
  keyTransform?: 'simpleName'
}

export interface HttpShape {
  /** Field name for the URL. Default 'url'. Windsurf uses 'serverUrl'. */
  urlField?: string
  /** Field name for the header map. Default 'headers'. */
  headerField?: string
  /** When set, write `{ [tagKey]: tagValue }` for http entries. */
  tagKey?: 'type' | 'transport'
  /**
   * Value written under `tagKey` for http entries. Known values:
   * 'http', 'streamableHttp' (Cline), 'streamable-http' (Kiro),
   * 'remote' (OpenCode). Applied to both `http` and `sse` transports
   * unless `sseTagValue` is set.
   */
  tagValue?: string
  /**
   * Value written under `tagKey` for SSE entries specifically. Use when
   * the client accepts both http and sse and distinguishes them by tag
   * value: Claude Code writes `type: "http"` for http and `type: "sse"`
   * for sse. When unset, SSE entries use `tagValue` (the shared value).
   */
  sseTagValue?: string
  /** Static fields merged into every http entry. */
  injects?: Record<string, unknown>
  /**
   * Whether the client advertises OAuth support for remote servers.
   *
   * Catalog data for consumers to branch on, reachable through
   * `getCatalogEntry(agent).http?.supportsOAuth`, not a feature flag this
   * library acts on. The emitters never write OAuth fields: a caller that
   * needs a token threads it through `spec.headers`, and the clients that
   * do model OAuth natively each spell it differently (Codex takes
   * `--bearer-token-env-var`, Claude Code `--client-id`, Devin
   * `oauthClientId`, OpenCode an `oauth` object), so there is no single
   * shape to emit.
   */
  supportsOAuth?: boolean
}

export interface ClientConfigSources {
  /** Required. URL to the client's first-party MCP documentation. */
  firstParty: string
  /** URL to the corroborating source we cross-checked at authoring time. Set when Smithery has an entry. */
  smithery?: string
  /** Free-form notes about drift between sources or edge cases. */
  notes?: string
  /** ISO date the entry was last verified against sources. Enforced by the validator (must be within 12 months). */
  verified: string
  /**
   * The client release the entry was verified against, e.g.
   * `'opencode@1.19.4'`.
   *
   * `verified` is a date, which answers when someone last looked and not
   * which client major they looked at. Those are different questions, and
   * only the second catches a breaking config change: an entry can read
   * as fresh for a year while describing a layout the current release
   * abandoned. Set it whenever the version is known.
   */
  verifiedAgainst?: string
}

export interface ClientConfig {
  id: ClientId
  displayName: string
  installCheckPaths: PerOsPaths
  systemPaths: PerOsPaths
  /** Relative to projectRoot when scope is 'project'. */
  projectFile?: string
  format: ConfigFormat
  supportedTransports: {
    system: ReadonlyArray<McpTransport>
    /** Set when project scope diverges from system scope. */
    project?: ReadonlyArray<McpTransport>
  }
  stdio: StdioShape
  /** Present iff `supportedTransports.system` includes 'http' or 'sse'. Enforced by the validator. */
  http?: HttpShape
  /** Present when project scope has divergent write shapes. Enforced by the validator. */
  project?: {
    stdio: StdioShape
    http?: HttpShape
  }
  /**
   * Present only for clients with a third, project-specific scope stored
   * inside the global config file rather than in the project directory.
   * Claude Code is the only one: `claude mcp add -s local` writes to
   * `projects.<cwd>.mcpServers` in `~/.claude.json`.
   */
  local?: {
    stdio: StdioShape
    http?: HttpShape
  }
  sources: ClientConfigSources
}
