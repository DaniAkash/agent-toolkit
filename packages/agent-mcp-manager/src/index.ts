export {
  detectInstalledAgents,
  isAgentSupported,
  listSupportedAgents,
  resolveAgentMcpConfigPath,
} from './agents.ts'

export {
  AgentNotSupportedError,
  ForeignEntryError,
  InvalidServerSpecError,
  McpManagerError,
  ServerNotFoundError,
  UnresolvedConfigPathError,
} from './errors.ts'

export type { McpManager } from './manager.ts'
export { createMcpManager } from './manager.ts'

export type {
  AddServerOptions,
  AddServerResult,
  AgentId,
  AgentInfo,
  AgentScope,
  InstalledServer,
  LinkServerOptions,
  LinkServerResult,
  ListLinksOptions,
  ListServersOptions,
  ManifestLinkEntry,
  ManifestServerEntry,
  McpHttpSpec,
  McpManagerOptions,
  McpServerLink,
  McpServerSpec,
  McpSseSpec,
  McpStdioSpec,
  RemoveServerOptions,
  RescanOptions,
  RescanResult,
  ServerManifest,
  UnlinkServerOptions,
  UnlinkServerResult,
} from './types.ts'

export const VERSION = '0.0.0'
