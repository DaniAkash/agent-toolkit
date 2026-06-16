import { expect, test } from 'bun:test'
import { HarnessAgent } from '@ai-sdk/harness/agent'
import type { Experimental_SandboxSession } from '@ai-sdk/provider-utils'
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel'
import { createAcpxHarness } from '../../src/acpx-harness.ts'
import { collectAgentEnv, describeForAgent } from './helpers.ts'

const AGENT = 'codex'
const SESSION_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Install the codex CLI inside the freshly-created sandbox so acpx can
 * spawn it on the first turn. Runs via HarnessAgent.onSandboxSession,
 * which fires after sandbox creation and before the harness adapter
 * starts; npm's global install short-circuits if the package is already
 * present, so resumed sessions are safe.
 */
const installCodex = async ({
  session,
  abortSignal,
}: {
  readonly session: Experimental_SandboxSession
  readonly sessionWorkDir: string
  readonly abortSignal?: AbortSignal
}) => {
  const result = await session.run({
    command: 'npm install -g @openai/codex',
    abortSignal,
  })
  if (result.exitCode !== 0) {
    throw new Error(
      `npm install -g @openai/codex exited ${result.exitCode}: ${result.stderr}`,
    )
  }
}

const buildAgent = () => {
  const harness = createAcpxHarness({ agent: 'codex' })
  const sandbox = createVercelSandbox({
    runtime: 'node22',
    env: collectAgentEnv(AGENT),
  })
  return new HarnessAgent({
    harness,
    sandbox,
    onSandboxSession: installCodex,
  })
}

describeForAgent(AGENT, 'acpx-ai-harness e2e (codex)', () => {
  test(
    'generate() returns text from a real codex turn',
    async () => {
      const agent = buildAgent()
      const session = await agent.createSession()
      try {
        const result = await agent.generate({
          session,
          prompt:
            'Reply with exactly the single word "ready" and nothing else.',
        })
        expect(typeof result.text).toBe('string')
        expect(result.text.length).toBeGreaterThan(0)
      } finally {
        await session.destroy()
      }
    },
    SESSION_TIMEOUT_MS,
  )

  test(
    'stream() yields incremental text-delta parts',
    async () => {
      const agent = buildAgent()
      const session = await agent.createSession()
      try {
        const result = await agent.stream({
          session,
          prompt: 'List the numbers 1, 2, and 3 each on a new line, then stop.',
        })
        const types: string[] = []
        for await (const part of result.fullStream) {
          types.push(part.type)
        }
        // We expect at least one text-delta and a finish frame for any
        // non-trivial codex turn.
        expect(types).toContain('text-delta')
        expect(types).toContain('finish')
      } finally {
        await session.destroy()
      }
    },
    SESSION_TIMEOUT_MS,
  )
})
