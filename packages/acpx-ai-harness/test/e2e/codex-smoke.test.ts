import { afterAll, expect, test } from 'bun:test'
import { HarnessAgent } from '@ai-sdk/harness/agent'
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel'
import { createAcpxHarness } from '../../src/acpx-harness.ts'
import { describeForAgent } from './helpers.ts'

const AGENT = 'codex'
const SESSION_TIMEOUT_MS = 5 * 60 * 1000

describeForAgent(AGENT, 'acpx-ai-harness e2e (codex)', () => {
  // Each test creates its own HarnessAgent so failures don't bleed across
  // tests; sandbox creation happens lazily inside agent.createSession().
  // The Vercel-side sandbox is destroyed by session.destroy() at the end
  // of each test.

  test(
    'generate() returns text from a real codex turn',
    async () => {
      const harness = createAcpxHarness({ agent: 'codex' })
      const sandbox = createVercelSandbox({
        runtime: 'node22',
      })
      const agent = new HarnessAgent({ harness, sandbox })

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
      const harness = createAcpxHarness({ agent: 'codex' })
      const sandbox = createVercelSandbox({
        runtime: 'node22',
      })
      const agent = new HarnessAgent({ harness, sandbox })

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

  // Sanity afterAll so an unclean test still produces a clean output
  afterAll(() => {
    // no-op; placeholder for future shared cleanup
  })
})
