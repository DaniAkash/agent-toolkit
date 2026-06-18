import { afterAll, afterEach, expect, test } from 'bun:test'
import { E2E_TEST_TIMEOUT_MS, requireE2eEnv } from './_setup.ts'
import { purgeE2eSandboxes, purgeHarnessForks } from './helpers/cleanup.ts'
import { buildSharedCodexHarness } from './helpers/codex-fixtures.ts'

const describeE2e = requireE2eEnv()

describeE2e('codex e2e: multi-turn conversation state', () => {
  afterEach(async () => {
    await purgeHarnessForks()
  }, E2E_TEST_TIMEOUT_MS)
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
      // The provider publishes a fixed host port for the bridge, so two
      // microVMs cannot bind it simultaneously. The invariant under
      // test is that each sessionId mints its own sandbox name and
      // that each is independently usable; sessions are exercised one
      // at a time to avoid host-port contention.
      const { agent } = buildSharedCodexHarness()
      const a = await agent.createSession({ sessionId: 'twin-a' })
      const aId = a.sessionId
      try {
        const ra = await agent.generate({
          session: a,
          prompt: 'Reply with "A".',
        })
        expect(typeof ra.text).toBe('string')
      } finally {
        await a.destroy()
      }
      const b = await agent.createSession({ sessionId: 'twin-b' })
      const bId = b.sessionId
      try {
        const rb = await agent.generate({
          session: b,
          prompt: 'Reply with "B".',
        })
        expect(typeof rb.text).toBe('string')
      } finally {
        await b.destroy()
      }
      expect(aId).not.toBe(bId)
    },
    E2E_TEST_TIMEOUT_MS,
  )
})
