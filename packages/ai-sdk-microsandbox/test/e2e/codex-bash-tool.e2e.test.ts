import { afterAll, expect, test } from 'bun:test'
import { E2E_TEST_TIMEOUT_MS, requireE2eEnv } from './_setup.ts'
import { purgeE2eSandboxes } from './helpers/cleanup.ts'
import { buildSharedCodexHarness } from './helpers/codex-fixtures.ts'

const describeE2e = requireE2eEnv()

describeE2e('codex e2e: bash tool through the bridge', () => {
  afterAll(async () => {
    await purgeE2eSandboxes()
  }, E2E_TEST_TIMEOUT_MS)

  test(
    'agent uses bash to list a directory and reports the output',
    async () => {
      const { agent } = buildSharedCodexHarness()
      const session = await agent.createSession()
      try {
        const result = await agent.generate({
          session,
          prompt:
            'Use bash to run `mkdir -p /root/proof && echo hello > /root/proof/hi.txt && ls /root/proof`. Then in your response include the word "hi.txt" if and only if the listing shows it.',
        })
        expect(result.text).toContain('hi.txt')
      } finally {
        await session.destroy()
      }
    },
    E2E_TEST_TIMEOUT_MS,
  )

  test(
    'agent observes stderr from a failed bash command',
    async () => {
      const { agent } = buildSharedCodexHarness()
      const session = await agent.createSession()
      try {
        const result = await agent.generate({
          session,
          prompt:
            'Use bash to `cat /this-does-not-exist`. Then in your response, quote the error message text bash printed.',
        })
        expect(result.text.toLowerCase()).toMatch(
          /no such file|cannot|does not exist/,
        )
      } finally {
        await session.destroy()
      }
    },
    E2E_TEST_TIMEOUT_MS,
  )
})
