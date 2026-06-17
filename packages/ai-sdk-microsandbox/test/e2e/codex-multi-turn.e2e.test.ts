import { afterAll, expect, test } from 'bun:test'
import { E2E_TEST_TIMEOUT_MS, requireE2eEnv } from './_setup.ts'
import { purgeE2eSandboxes } from './helpers/cleanup.ts'
import { buildSharedCodexHarness } from './helpers/codex-fixtures.ts'

const describeE2e = requireE2eEnv()

describeE2e('codex e2e — multi-turn conversation state', () => {
  afterAll(async () => {
    await purgeE2eSandboxes()
  }, E2E_TEST_TIMEOUT_MS)

  test(
    'second turn in the same session remembers context from the first',
    async () => {
      const { agent } = buildSharedCodexHarness()
      const session = await agent.createSession()
      try {
        await agent.generate({
          session,
          prompt: 'Remember the secret word "marigold". Acknowledge briefly.',
        })
        const followup = await agent.generate({
          session,
          prompt: 'What was the secret word I asked you to remember?',
        })
        expect(followup.text.toLowerCase()).toContain('marigold')
      } finally {
        await session.destroy()
      }
    },
    E2E_TEST_TIMEOUT_MS,
  )

  test(
    'two sessions in the same provider get distinct sandboxes',
    async () => {
      const { agent } = buildSharedCodexHarness()
      const a = await agent.createSession({ sessionId: 'twin-a' })
      const b = await agent.createSession({ sessionId: 'twin-b' })
      try {
        expect(a.sessionId).not.toBe(b.sessionId)
        // Touch both — proves both microVMs are independently usable.
        const [ra, rb] = await Promise.all([
          agent.generate({ session: a, prompt: 'Reply with "A".' }),
          agent.generate({ session: b, prompt: 'Reply with "B".' }),
        ])
        expect(typeof ra.text).toBe('string')
        expect(typeof rb.text).toBe('string')
      } finally {
        await a.destroy()
        await b.destroy()
      }
    },
    E2E_TEST_TIMEOUT_MS,
  )
})
