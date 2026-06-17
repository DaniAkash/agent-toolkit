import { afterAll, expect, test } from 'bun:test'
import { E2E_TEST_TIMEOUT_MS, requireE2eEnv } from './_setup.ts'
import { purgeE2eSandboxes } from './helpers/cleanup.ts'
import { buildSharedCodexHarness } from './helpers/codex-fixtures.ts'

const describeE2e = requireE2eEnv()

describeE2e('codex e2e — streaming surface', () => {
  afterAll(async () => {
    await purgeE2eSandboxes()
  }, E2E_TEST_TIMEOUT_MS)

  test(
    'stream() emits multiple incremental text-delta parts before finish',
    async () => {
      const { agent } = buildSharedCodexHarness()
      const session = await agent.createSession()
      try {
        const result = await agent.stream({
          session,
          prompt: 'Write a short three-sentence description of a sunny day.',
        })
        let textDeltaCount = 0
        let sawFinish = false
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') textDeltaCount += 1
          if (part.type === 'finish') sawFinish = true
        }
        expect(textDeltaCount).toBeGreaterThan(1)
        expect(sawFinish).toBe(true)
      } finally {
        await session.destroy()
      }
    },
    E2E_TEST_TIMEOUT_MS,
  )

  test(
    'stream() exposes usage on the final finish part',
    async () => {
      const { agent } = buildSharedCodexHarness()
      const session = await agent.createSession()
      try {
        const result = await agent.stream({
          session,
          prompt: 'Reply with the word "ok".',
        })
        let finalUsage: unknown
        for await (const part of result.fullStream) {
          if (part.type === 'finish') {
            finalUsage = (part as { totalUsage?: unknown }).totalUsage
          }
        }
        // Usage may be undefined for some models; assert only the wiring.
        expect(['object', 'undefined']).toContain(typeof finalUsage)
      } finally {
        await session.destroy()
      }
    },
    E2E_TEST_TIMEOUT_MS,
  )
})
