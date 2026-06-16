import { describe } from 'bun:test'

/**
 * Helpers for running e2e tests against real ACP agents through a real
 * harness sandbox.
 *
 * The suite is gated by `SMOKE_AGENTS` so it doesn't run on every test
 * invocation. Values:
 *   - unset → suite is skipped entirely
 *   - 'all' → every supported agent runs
 *   - comma-separated list (e.g. 'codex,claude') → those agents run
 *
 * Bridge-backed harnesses also require a sandbox provider with port
 * exposure (just-bash cannot expose ports for our WebSocket bridge), so
 * Vercel sandbox credentials need to be present. Each ACP agent also
 * needs its own auth env to reach its provider (codex → OPENAI_API_KEY,
 * etc.). Without the right env, the suite skips.
 */

const AGENTS_ENV = 'SMOKE_AGENTS'
const VERCEL_ENV_VARS = ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID']

const AGENT_AUTH_ENV: Record<string, ReadonlyArray<string>> = {
  codex: ['OPENAI_API_KEY'],
  claude: ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY'],
}

export function selectedAgents(): ReadonlySet<string> {
  const raw = process.env[AGENTS_ENV]
  if (!raw) return new Set()
  if (raw === 'all') return new Set(['codex', 'claude', 'gemini'])
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

export function hasVercelSandboxCredentials(): boolean {
  return VERCEL_ENV_VARS.every((k) => Boolean(process.env[k]))
}

export function hasAgentAuthCredentials(agent: string): boolean {
  const required = AGENT_AUTH_ENV[agent] ?? []
  return required.every((k) => Boolean(process.env[k]))
}

export function agentAuthEnvVars(agent: string): ReadonlyArray<string> {
  return AGENT_AUTH_ENV[agent] ?? []
}

export function shouldRun(agent: string): boolean {
  return (
    selectedAgents().has(agent) &&
    hasVercelSandboxCredentials() &&
    hasAgentAuthCredentials(agent)
  )
}

/**
 * Skip-aware describe. When a gate doesn't pass, the describe block is
 * registered as a skipped suite with a message naming the env var(s) the
 * caller still needs to set.
 */
export const describeForAgent = (
  agent: string,
  name: string,
  fn: () => void,
): void => {
  if (shouldRun(agent)) {
    describe(name, fn)
    return
  }
  const why = (() => {
    if (!selectedAgents().has(agent))
      return `set SMOKE_AGENTS=${agent} (or 'all') to enable`
    if (!hasVercelSandboxCredentials())
      return `set ${VERCEL_ENV_VARS.join(' / ')} to enable`
    return `set ${agentAuthEnvVars(agent).join(' / ')} to enable`
  })()
  describe.skip(`${name} [${why}]`, fn)
}

/**
 * Collect the agent-auth env vars present in the host process so they can
 * be threaded into the sandbox at creation time.
 */
export function collectAgentEnv(agent: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of agentAuthEnvVars(agent)) {
    const value = process.env[key]
    if (value) out[key] = value
  }
  return out
}
