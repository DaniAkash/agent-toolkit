import { agents as catalog } from './_vendor/agents.ts'
import { AgentNotSupportedError } from './errors.ts'
import type { AgentId, AgentInfo } from './types.ts'

export { detectInstalledAgents } from './_vendor/agents.ts'

const KNOWN: ReadonlySet<AgentId> = new Set(Object.keys(catalog) as AgentId[])

export function isAgentSupported(id: string): id is AgentId {
  return KNOWN.has(id as AgentId)
}

/**
 * Resolve the absolute path of an agent's default skills directory.
 * Uses `globalSkillsDir` from the catalog (which `vercel-labs/skills`
 * resolves against the user's home dir at import time) when present;
 * otherwise falls back to the relative `skillsDir`.
 */
export function resolveAgentSkillsDir(agent: AgentId): string {
  const entry = catalog[agent]
  if (!entry) throw new AgentNotSupportedError(`Unknown agent: ${agent}`)
  return entry.globalSkillsDir ?? entry.skillsDir
}

export function listSupportedAgents(): AgentInfo[] {
  return (Object.keys(catalog) as AgentId[]).map((id) => ({
    id,
    displayName: catalog[id].displayName,
    defaultSkillsDir: resolveAgentSkillsDir(id),
    installed: false, // static catalog; use detectInstalledAgents() for the live answer
  }))
}
