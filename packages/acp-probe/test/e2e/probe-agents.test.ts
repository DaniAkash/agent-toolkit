/**
 * End-to-end probe tests against real ACP agents.
 *
 * NOT run in CI — these spawn real adapter processes (claude / codex /
 * gemini), perform a real ACP handshake, and need the corresponding
 * CLIs available locally. They exist so contributors can verify
 * changes against agents the fake-agent harness can't catch: npx
 * download drift, agent CLI version skew, real schema evolution.
 *
 * How to run:
 *
 *   # All three agents
 *   PROBE_E2E=all bun test test/e2e
 *
 *   # Single agent
 *   PROBE_E2E=claude bun test test/e2e
 *
 *   # Multiple
 *   PROBE_E2E=claude,codex bun test test/e2e
 *
 * What each test covers — every probed agent runs TWO paths:
 *
 *   - `{ agent: 'claude' }` — the convenience path. Uses acpx (a
 *     devDep here) to resolve the spawn command via acpx's built-in
 *     registry.
 *
 *   - `{ command: 'npx -y …' }` — the canonical path that doesn't
 *     touch acpx at all. Equivalent to what a consumer without acpx
 *     installed would write.
 *
 * Both paths must surface the same `models`, `modes`, `configOptions`,
 * `reasoning`, and `supportsConfigOption` for a given agent. Any
 * difference signals a regression in either resolve-command.ts or in
 * the spawn command we keep duplicated here.
 *
 * No LLM tokens are consumed — the probe is `initialize` + `session/new`
 * + optional `set_config_option` ping only.
 */

import { describe, expect, test } from 'bun:test'
import { type AgentProbeResult, probeAgent } from '../../src/index.ts'

const REQUESTED = (process.env.PROBE_E2E ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const ALL_REQUESTED = REQUESTED.includes('all')
const shouldRun = (agent: string): boolean =>
  ALL_REQUESTED || REQUESTED.includes(agent)

/**
 * Agents whose capability surface is asserted below.
 *
 * gemini is not among them. Its ACP endpoint now answers every probe with
 * `-32000 "This client is no longer supported for Gemini Code Assist for
 * individuals. ... migrate to the Antigravity suite"`, so there is no
 * capability surface left to assert on an individual account and the old
 * expectations could never pass. It is covered by its own contract test
 * at the bottom of this file instead, which asserts the thing that is
 * still true and still worth knowing: an agent-level failure is reported,
 * not thrown.
 *
 * If individual ACP access is restored, move gemini back into this list
 * and restore the capability expectations from git history.
 */
const AGENTS = ['claude', 'codex'] as const
type ProbeAgent = (typeof AGENTS)[number]
const SPAWN_AGENTS = ['claude', 'codex', 'gemini'] as const
type SpawnAgent = (typeof SPAWN_AGENTS)[number]

// Hardcoded spawn commands for the no-acpx path. These mirror acpx's
// AGENT_REGISTRY at the time of capture (2026-10-26, acpx 0.21.0). Drift
// between these and the registry is what the side-by-side assertion
// catches, and it did: the previous capture still named
// `@zed-industries/codex-acp`, which codex has since left for
// `@agentclientprotocol/codex-acp`.
const SPAWN_COMMAND: Record<SpawnAgent, string> = {
  claude: 'npx -y @agentclientprotocol/claude-agent-acp@^0.81.2',
  codex: 'npx -y @agentclientprotocol/codex-acp@^1.1.5',
  gemini: 'gemini --acp',
}

// Per-agent stable invariants captured 2026-05-14. These are the
// minimums; the actual responses may include more fields. We don't
// snapshot the whole result because adapter versions evolve.
const EXPECTATIONS: Record<ProbeAgent, (r: AgentProbeResult) => void> = {
  claude(r) {
    expect(r.error).toBeUndefined()
    expect(r.protocolVersion).toBe(1)
    expect(r.agentInfo?.name).toContain('claude-agent-acp')
    expect(r.capabilities.promptCapabilities.image).toBe(true)
    expect(r.capabilities.promptCapabilities.embeddedContext).toBe(true)
    expect(r.capabilities.loadSession).toBe(true)
    expect(r.models.length).toBeGreaterThan(0)
    expect(r.modes.length).toBeGreaterThan(0)
    expect(r.configOptions.length).toBeGreaterThan(0)
    expect(r.reasoning?.configId).toBe('effort')
    expect(r.reasoning?.values).toContain('low')
    expect(r.reasoning?.values).toContain('high')
    expect(r.modelConfig?.configId).toBe('model')
    expect(r.modelConfig?.values.length ?? 0).toBeGreaterThan(0)
    expect(typeof r.modelConfig?.currentValue).toBe('string')
    expect(r.supportsConfigOption).toBe(true)
  },
  codex(r) {
    expect(r.error).toBeUndefined()
    expect(r.protocolVersion).toBe(1)
    expect(r.agentInfo?.name).toContain('codex-acp')
    expect(r.capabilities.promptCapabilities.image).toBe(true)
    expect(r.models.length).toBeGreaterThan(0)
    expect(r.modes.length).toBeGreaterThan(0)
    expect(r.configOptions.length).toBeGreaterThan(0)
    expect(r.reasoning?.configId).toBe('reasoning_effort')
    expect(r.reasoning?.values).toContain('low')
    expect(r.modelConfig?.configId).toBe('model')
    expect(r.modelConfig?.values.length ?? 0).toBeGreaterThan(0)
    // codex's settable ids are the bare model names, never the compound
    // `<model>/<effort>` ids. In ACP 1.x these are the only model ids (the
    // declarative model list was removed), so r.models mirrors them.
    expect(r.modelConfig?.values.every((v) => !v.includes('/'))).toBe(true)
    expect(r.models.every((m) => !m.id.includes('/'))).toBe(true)
    expect(r.supportsConfigOption).toBe(true)
  },
}

// First-run npx downloads can take 30-60s on a cold network.
const TURN_TIMEOUT_MS = 90_000

for (const agent of AGENTS) {
  describe(`e2e probe — ${agent}`, () => {
    test.skipIf(!shouldRun(agent))(
      `probeAgent({ agent: '${agent}' }) — acpx-resolution path`,
      async () => {
        const result = await probeAgent({
          agent,
          timeoutMs: TURN_TIMEOUT_MS,
        })
        expect(result.agent.id).toBe(agent)
        EXPECTATIONS[agent](result)
      },
      TURN_TIMEOUT_MS + 5_000,
    )

    test.skipIf(!shouldRun(agent))(
      `probeAgent({ command: '${SPAWN_COMMAND[agent]}' }) — no-acpx path`,
      async () => {
        const result = await probeAgent({
          command: SPAWN_COMMAND[agent],
          timeoutMs: TURN_TIMEOUT_MS,
        })
        expect(result.agent.id).toBeNull()
        expect(result.agent.command).toBe(SPAWN_COMMAND[agent])
        EXPECTATIONS[agent](result)
      },
      TURN_TIMEOUT_MS + 5_000,
    )

    test.skipIf(!shouldRun(agent))(
      `both paths produce structurally identical capabilities for ${agent}`,
      async () => {
        const [viaAcpx, viaCommand] = await Promise.all([
          probeAgent({ agent, timeoutMs: TURN_TIMEOUT_MS }),
          probeAgent({
            command: SPAWN_COMMAND[agent],
            timeoutMs: TURN_TIMEOUT_MS,
          }),
        ])

        // Only the agent.id / agent.command / probedAt / durationMs
        // legitimately differ — everything else should match. Compare
        // the core capability surface verbatim.
        expect(viaAcpx.protocolVersion).toBe(viaCommand.protocolVersion)
        expect(viaAcpx.agentInfo?.name).toBe(viaCommand.agentInfo?.name)
        expect(viaAcpx.capabilities).toEqual(viaCommand.capabilities)
        expect(viaAcpx.models.map((m) => m.id)).toEqual(
          viaCommand.models.map((m) => m.id),
        )
        expect(viaAcpx.modes.map((m) => m.id)).toEqual(
          viaCommand.modes.map((m) => m.id),
        )
        expect(viaAcpx.configOptions.map((o) => o.id)).toEqual(
          viaCommand.configOptions.map((o) => o.id),
        )
        expect(viaAcpx.reasoning).toEqual(viaCommand.reasoning)
        expect(viaAcpx.modelConfig).toEqual(viaCommand.modelConfig)
        expect(viaAcpx.supportsConfigOption).toBe(
          viaCommand.supportsConfigOption,
        )
      },
      2 * (TURN_TIMEOUT_MS + 5_000),
    )
  })
}

/**
 * gemini: the agent-error contract, against a real process.
 *
 * Gemini's ACP endpoint was withdrawn for individual accounts, so probing
 * it returns a JSON-RPC error rather than a capability set. That makes it
 * the one real agent available here that exercises the error path end to
 * end, which is worth keeping: the mock harness can construct an error
 * response, but only a live agent proves the probe reports a real one
 * instead of throwing or hanging.
 *
 * Written to hold whether or not access is restored. The contract is that
 * `probeAgent` resolves with a well-formed result either way, and that an
 * agent-returned JSON-RPC error arrives as a structured `acpError` with
 * its numeric code preserved rather than flattened into a message.
 */
describe('e2e probe: gemini agent-error contract', () => {
  test.skipIf(!shouldRun('gemini'))(
    'an agent-level failure is reported, not thrown',
    async () => {
      const r = await probeAgent({
        command: SPAWN_COMMAND.gemini,
        timeoutMs: TURN_TIMEOUT_MS,
      })

      // Resolved, not thrown, and shaped like a result in both outcomes.
      expect(r.agent.command).toBe(SPAWN_COMMAND.gemini)
      expect(typeof r.agent.durationMs).toBe('number')
      expect(Array.isArray(r.authMethods)).toBe(true)

      if (!r.error) {
        // Access restored: it must look like a working ACP agent again.
        expect(r.protocolVersion).toBe(1)
        expect(r.agentInfo?.name).toBe('gemini-cli')
        return
      }

      // The withdrawn-access path. The probe must classify it rather than
      // crash, and must not lose the agent's own error code.
      expect(r.error.code).toBe('unknown')
      expect(r.error.message.length).toBeGreaterThan(0)
      expect(typeof r.error.acpError?.code).toBe('number')
      // Partial values stay readable alongside the error.
      expect(r.raw.newSession).toBeNull()
    },
    TURN_TIMEOUT_MS,
  )
})
