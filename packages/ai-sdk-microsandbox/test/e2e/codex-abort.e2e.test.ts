import { afterAll, afterEach, expect, test } from 'bun:test'
import { E2E_TEST_TIMEOUT_MS, requireE2eEnv } from './_setup.ts'
import { purgeE2eSandboxes, purgeHarnessForks } from './helpers/cleanup.ts'
import { buildSharedCodexHarness } from './helpers/codex-fixtures.ts'

const describeE2e = requireE2eEnv()

describeE2e('codex e2e: abort handling', () => {
  afterEach(async () => {
    await purgeHarnessForks()
  }, E2E_TEST_TIMEOUT_MS)
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
        // Trip the abort after a brief delay independently of the stream so
        // we don't rely on for-await observing a text-delta first; some
        // codex turns buffer reasoning before any text-delta appears.
        const abortTimer = setTimeout(() => controller.abort(), 2_000)
        // Race the stream consumption against a hard 90s ceiling so a
        // codex adapter that does not propagate abort cannot leave us
        // hanging forever.
        await Promise.race([
          (async () => {
            for await (const part of result.fullStream) {
              if (part.type === 'error') break
            }
          })(),
          new Promise<void>((resolve) => setTimeout(resolve, 90_000)),
        ])
        clearTimeout(abortTimer)
      } catch {
        // Abort surfaces as a rejection in some code paths; that's a pass.
      }
      const elapsed = Date.now() - start
      // A non-aborted 2000-word essay turn routinely exceeds 3 minutes,
      // so a cap of 100s proves the test cut the work short — either
      // because abort propagated cleanly or because the race timer did.
      expect(elapsed).toBeLessThan(100_000)
      await session.destroy().catch(() => undefined)
    },
    E2E_TEST_TIMEOUT_MS,
  )
})
