import { afterAll, expect, test } from 'bun:test'
import { E2E_TEST_TIMEOUT_MS, requireE2eEnv } from './_setup.ts'
import { purgeE2eSandboxes } from './helpers/cleanup.ts'
import { buildSharedCodexHarness } from './helpers/codex-fixtures.ts'

const describeE2e = requireE2eEnv()

describeE2e('codex e2e: cross-process resume', () => {
  afterAll(async () => {
    await purgeE2eSandboxes()
  }, E2E_TEST_TIMEOUT_MS)

  test(
    'session.stop() returns resume state that agent.createSession({ resumeFrom }) can pick up',
    async () => {
      const { agent } = buildSharedCodexHarness()
      const sessionId = `resume-test-${Date.now()}`
      const session1 = await agent.createSession({ sessionId })
      await agent.generate({
        session: session1,
        prompt:
          'Use bash to write the text "persisted" to /workspace/persist.txt.',
      })
      const resumeFrom = await session1.stop()
      expect(resumeFrom).toBeDefined()

      // Build a fresh agent (simulating a new process) and resume.
      const { agent: agent2 } = buildSharedCodexHarness()
      const session2 = await agent2.createSession({ sessionId, resumeFrom })
      try {
        const readback = await agent2.generate({
          session: session2,
          prompt: 'Use bash to print the contents of /workspace/persist.txt.',
        })
        expect(readback.text).toContain('persisted')
      } finally {
        await session2.destroy()
      }
    },
    E2E_TEST_TIMEOUT_MS,
  )
})
