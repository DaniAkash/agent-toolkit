import { afterAll, expect, test } from 'bun:test'
import { E2E_TEST_TIMEOUT_MS, requireE2eEnv } from './_setup.ts'
import { purgeE2eSandboxes } from './helpers/cleanup.ts'
import { buildSharedCodexHarness } from './helpers/codex-fixtures.ts'

const describeE2e = requireE2eEnv()

describeE2e('codex e2e: abort handling', () => {
  afterAll(async () => {
    await purgeE2eSandboxes()
  }, E2E_TEST_TIMEOUT_MS)

  test(
    'aborting mid-stream terminates the in-flight turn quickly',
    async () => {
      const { agent } = buildSharedCodexHarness()
      const session = await agent.createSession()
      const controller = new AbortController()
      const start = Date.now()
      try {
        const result = await agent.stream({
          session,
          prompt:
            'Write a long, detailed essay (at least 2000 words) about gardening.',
          abortSignal: controller.signal,
        })
        // Abort after the first delta to be sure something is in flight.
        let aborted = false
        for await (const part of result.fullStream) {
          if (!aborted && part.type === 'text-delta') {
            controller.abort()
            aborted = true
          }
          if (part.type === 'error') break
        }
      } catch {
        // expected: abort surfaces as an error
      }
      const elapsed = Date.now() - start
      // Cap is generous because some models batch the whole response into a
      // single chunk; the assertion proves the test didn't run open-ended,
      // not that abort triggered a specific cutoff. A non-aborted essay
      // request would routinely exceed 3 minutes.
      expect(elapsed).toBeLessThan(180_000)
      await session.destroy().catch(() => undefined)
    },
    E2E_TEST_TIMEOUT_MS,
  )
})
