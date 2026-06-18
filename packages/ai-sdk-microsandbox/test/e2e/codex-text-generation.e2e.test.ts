import { afterAll, afterEach, expect, test } from 'bun:test'
import { E2E_TEST_TIMEOUT_MS, requireE2eEnv } from './_setup.ts'
import { purgeE2eSandboxes, purgeHarnessForks } from './helpers/cleanup.ts'
import { buildSharedCodexHarness } from './helpers/codex-fixtures.ts'
import { assertWithinBudget } from './helpers/cost-budget.ts'

const describeE2e = requireE2eEnv()

describeE2e('codex e2e: text generation', () => {
  afterEach(async () => {
    await purgeHarnessForks()
  }, E2E_TEST_TIMEOUT_MS)
  afterAll(async () => {
    await purgeE2eSandboxes()
  }, E2E_TEST_TIMEOUT_MS)

  test(
    'generate() returns a real text completion from a real Codex turn',
    async () => {
      const { agent } = buildSharedCodexHarness()
      const session = await agent.createSession()
      try {
        const result = await agent.generate({
          session,
          prompt:
            "Reply with exactly the single word 'banana' and nothing else.",
        })
        expect(typeof result.text).toBe('string')
        expect(result.text.length).toBeGreaterThan(0)
        expect(result.text.toLowerCase()).toContain('banana')
        assertWithinBudget(result.usage, { input: 15_000, output: 500 })
      } finally {
        await session.destroy()
      }
    },
    E2E_TEST_TIMEOUT_MS,
  )

  test(
    'stream() emits text-delta parts and a final finish part',
    async () => {
      const { agent } = buildSharedCodexHarness()
      const session = await agent.createSession()
      try {
        const result = await agent.stream({
          session,
          prompt: 'Count from 1 to 3, each on its own line, then stop.',
        })
        const types: string[] = []
        for await (const part of result.fullStream) {
          types.push(part.type)
        }
        expect(types).toContain('text-delta')
        expect(types).toContain('finish')
      } finally {
        await session.destroy()
      }
    },
    E2E_TEST_TIMEOUT_MS,
  )
})
