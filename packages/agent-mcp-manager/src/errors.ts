import type { AgentId } from './types.ts'

export class McpManagerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'McpManagerError'
    if (options?.cause !== undefined) {
      ;(this as { cause?: unknown }).cause = options.cause
    }
  }
}

export class AgentNotSupportedError extends McpManagerError {
  readonly agent: string
  constructor(agent: string) {
    super(`Agent not supported: ${agent}`)
    this.name = 'AgentNotSupportedError'
    this.agent = agent
  }
}

export class ServerNotFoundError extends McpManagerError {
  readonly serverName: string
  constructor(serverName: string) {
    super(`No server named "${serverName}" in the manifest`)
    this.name = 'ServerNotFoundError'
    this.serverName = serverName
  }
}

/**
 * Raised by `unlink()` when the on-disk entry under that key was not
 * written by this library (no manifest record). Callers can retry with
 * `force: true` (future) or run `rescan({ mode: 'merge' })` to adopt it.
 */
export class ForeignEntryError extends McpManagerError {
  readonly serverName: string
  readonly agent: AgentId
  readonly configPath: string
  constructor(serverName: string, agent: AgentId, configPath: string) {
    super(
      `Entry "${serverName}" in ${configPath} was not written by agent-mcp-manager for agent "${agent}". Refusing to remove.`,
    )
    this.name = 'ForeignEntryError'
    this.serverName = serverName
    this.agent = agent
    this.configPath = configPath
  }
}

export class InvalidServerSpecError extends McpManagerError {
  constructor(reason: string) {
    super(`Invalid MCP server spec: ${reason}`)
    this.name = 'InvalidServerSpecError'
  }
}

export class UnresolvedConfigPathError extends McpManagerError {
  readonly agent: AgentId
  constructor(agent: AgentId, reason: string) {
    super(`Cannot resolve config path for agent "${agent}": ${reason}`)
    this.name = 'UnresolvedConfigPathError'
    this.agent = agent
  }
}
