export {
  detectInstalledAgents,
  getCatalogEntry,
  isAgentSupported,
  listSupportedAgents,
  resolveAgentMcpConfigPath,
  resolveAgentSurface,
} from './agents.ts'

export {
  AgentNotSupportedError,
  ForeignEntryError,
  InvalidServerSpecError,
  McpManagerError,
  ServerNotFoundError,
  UnresolvedConfigPathError,
  UnsupportedTransportError,
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
  McpTransport,
  RemoveServerOptions,
  RescanOptions,
  RescanResult,
  ServerManifest,
  UnlinkServerOptions,
  UnlinkServerResult,
} from './types.ts'

export const VERSION = '0.0.0'
