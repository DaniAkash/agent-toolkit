import { afterAll, afterEach, expect, test } from 'bun:test'
import { E2E_TEST_TIMEOUT_MS, requireE2eEnv } from './_setup.ts'
import { purgeE2eSandboxes, purgeHarnessForks } from './helpers/cleanup.ts'
import { buildSharedCodexHarness } from './helpers/codex-fixtures.ts'

const describeE2e = requireE2eEnv()

describeE2e('codex e2e: cross-process resume', () => {
  afterEach(async () => {
    await purgeHarnessForks()
  }, E2E_TEST_TIMEOUT_MS)
  afterAll(async () => {
    await purgeE2eSandboxes()
  }, E2E_TEST_TIMEOUT_MS)

  test(
    'session.detach() returns resume state that agent.createSession({ resumeFrom }) can pick up',
    async () => {
      // The harness exposes two ways to obtain resume state: `detach()`
      // (keeps the sandbox + runtime running, only the local handle ends)
      // and `stop()` (also tears down the runtime + sandbox). The codex
      // adapter's `stop()` runs `proc.wait()` on the bridge process it
      // just killed, which surfaces a Runtime "exec session ended" error
      // even though the resume state was already collected. `detach()`
      // does not touch the bridge process and is the canonical
      // cross-process-resume mechanism documented on `HarnessAgentSession`.
      const { agent } = buildSharedCodexHarness()
      const sessionId = `resume-test-${Date.now()}`
      const session1 = await agent.createSession({ sessionId })
      await agent.generate({
        session: session1,
        prompt: 'Use bash to write the text "persisted" to /root/persist.txt.',
      })
      const resumeFrom = await session1.detach()
      expect(resumeFrom).toBeDefined()

      // Build a fresh agent (simulating a new process) and resume into
      // the still-running sandbox via the resume state.
      const { agent: agent2 } = buildSharedCodexHarness()
      const session2 = await agent2.createSession({ sessionId, resumeFrom })
      try {
        const readback = await agent2.generate({
          session: session2,
          prompt: 'Use bash to print the contents of /root/persist.txt.',
        })
        expect(readback.text).toContain('persisted')
      } finally {
        await session2.destroy()
      }
    },
    E2E_TEST_TIMEOUT_MS,
  )
})
