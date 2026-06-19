import * as path from 'node:path'
import { anyExists, expandPaths, pickConfigPath } from './_internal/paths.ts'
import {
  CATALOG,
  CATALOG_BY_ID,
  type CatalogEntry,
  type EmitterConfig,
} from './_vendor/catalog.ts'
import { AgentNotSupportedError, UnresolvedConfigPathError } from './errors.ts'
import type { AgentId, AgentInfo, AgentScope, McpTransport } from './types.ts'

const ALL_TRANSPORTS: ReadonlyArray<McpTransport> = ['stdio', 'sse', 'http']

const PLATFORMS = ['darwin', 'linux', 'win32'] as const
type Platform = (typeof PLATFORMS)[number]

function currentPlatform(): Platform {
  const p = process.platform
  if (p === 'darwin' || p === 'linux' || p === 'win32') return p
  // Fall back to linux conventions for unknown unixes.
  return 'linux'
}

function pickOsList(map: Partial<Record<Platform, string[]>>): string[] {
  return map[currentPlatform()] ?? []
}

export function listSupportedAgents(): AgentId[] {
  return CATALOG.map((entry) => entry.id)
}

export function isAgentSupported(agent: string): agent is AgentId {
  return Object.hasOwn(CATALOG_BY_ID, agent)
}

export function getCatalogEntry(agent: AgentId): CatalogEntry {
  const entry = CATALOG_BY_ID[agent]
  if (!entry) throw new AgentNotSupportedError(agent)
  return entry
}

/**
 * Resolve the config file path agent-mcp-manager would write to for
 * this agent under the given scope. Throws when the path isn't
 * resolvable on this OS or when project scope is requested for an
 * agent that has no project file.
 */
export async function resolveAgentMcpConfigPath(
  agent: AgentId,
  scope: AgentScope = 'system',
  projectRoot?: string,
): Promise<string> {
  const entry = getCatalogEntry(agent)
  if (scope === 'project') {
    if (!entry.projectFile) {
      throw new UnresolvedConfigPathError(
        agent,
        `agent has no project-scope config file`,
      )
    }
    if (!projectRoot) {
      throw new UnresolvedConfigPathError(
        agent,
        `projectRoot is required when scope === 'project'`,
      )
    }
    return path.join(projectRoot, entry.projectFile)
  }
  const candidates = pickOsList(entry.systemPaths)
  if (candidates.length === 0) {
    throw new UnresolvedConfigPathError(
      agent,
      `no system config path configured for OS ${currentPlatform()}`,
    )
  }
  const picked = await pickConfigPath(candidates)
  if (!picked) {
    throw new UnresolvedConfigPathError(
      agent,
      `no system config path resolves (env vars unset?)`,
    )
  }
  return picked
}

/**
 * Resolve the emitter config and transport-capability set the library
 * uses for the given agent at the given scope. Project scope falls
 * back to system scope when the catalog entry does not declare a
 * project-specific override.
 */
export function resolveAgentSurface(
  agent: AgentId,
  scope: AgentScope = 'system',
): {
  emitterConfig: EmitterConfig
  supportedTransports: ReadonlyArray<McpTransport>
} {
  const entry = getCatalogEntry(agent)
  if (scope === 'project') {
    return {
      emitterConfig: entry.projectEmitterConfig ?? entry.emitterConfig,
      supportedTransports:
        entry.projectSupportedTransports ??
        entry.supportedTransports ??
        ALL_TRANSPORTS,
    }
  }
  return {
    emitterConfig: entry.emitterConfig,
    supportedTransports: entry.supportedTransports ?? ALL_TRANSPORTS,
  }
}

export async function detectInstalledAgents(): Promise<AgentInfo[]> {
  const out: AgentInfo[] = []
  for (const entry of CATALOG) {
    const checks = expandPaths(pickOsList(entry.installCheckPaths))
    const installed = await anyExists(checks)
    let configPath: string | null = null
    try {
      configPath = await resolveAgentMcpConfigPath(entry.id, 'system')
    } catch {
      configPath = null
    }
    out.push({
      id: entry.id,
      displayName: entry.displayName,
      configPath,
      installed,
    })
  }
  return out
}
