// AgentId re-exports the 23-client union declared in the internal
// catalog. Kept as a name alias for API surface continuity: consumers
// import `AgentId` from the package root, the catalog's `ClientId`
// stays internal.
import type { ClientId } from './_catalog/types.ts'

export type AgentId = ClientId

/**
 * Which of a client's configuration surfaces to write.
 *
 * `system` is the single global file, which is what 22 of the 23 clients
 * have. `project` is a file in the project directory. `local` is a third
 * surface that lives *inside* the global file, keyed by project: Claude
 * Code's `claude mcp add -s local` writes `projects.<cwd>.mcpServers` in
 * `~/.claude.json`, and it is that client's default scope.
 *
 * `system` is kept as the name for what Claude Code calls `user`, since
 * it is the correct name for the other 22 clients, where there is one
 * global file and no per-project container.
 */
export type AgentScope = 'system' | 'project' | 'local'

export type McpTransport = 'stdio' | 'sse' | 'http'

export interface AgentInfo {
  id: AgentId
  displayName: string
  /** Absolute path of the config file we would write to (or null when unresolvable on this OS). */
  configPath: string | null
  /** True iff one of the agent's `installCheckPaths` resolves on disk. */
  installed: boolean
}

export interface McpStdioSpec {
  transport: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface McpSseSpec {
  transport: 'sse'
  url: string
  headers?: Record<string, string>
}

export interface McpHttpSpec {
  transport: 'http'
  url: string
  headers?: Record<string, string>
}

export type McpServerSpec = McpStdioSpec | McpSseSpec | McpHttpSpec

/**
 * The unit of work every mutating verb takes. Caller-owned data:
 * `name` is the manifest key; `spec` describes how the server is
 * invoked. Passed to `link()` directly; the library never persists
 * a server independently of a link.
 */
export interface McpServer {
  name: string
  spec: McpServerSpec
}

export interface ServerManifest {
  version: 1
  servers: Record<string, ManifestServerEntry>
}

export interface ManifestServerEntry {
  name: string
  spec: McpServerSpec
  addedAt: string
  links: Partial<Record<AgentId, ManifestLinkEntry>>
}

export interface ManifestLinkEntry {
  configPath: string
  createdAt: string
  /**
   * The scope the link was created at. Absent on entries written before
   * this field existed, which are read as `'system'`.
   *
   * Required because `local` scope shares a file with `system` and is told
   * apart only by the container inside it. Without this, removal read the
   * right file and then deleted from the wrong container.
   */
  scope?: AgentScope
  /**
   * The project root a `local` link was created against, needed to rebuild
   * its container path (`projects.<root>.mcpServers`) on removal.
   */
  projectRoot?: string
}
