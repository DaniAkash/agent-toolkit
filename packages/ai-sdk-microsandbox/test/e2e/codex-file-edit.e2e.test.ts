import { afterAll, expect, test } from 'bun:test'
import { E2E_TEST_TIMEOUT_MS, requireE2eEnv } from './_setup.ts'
import { purgeE2eSandboxes } from './helpers/cleanup.ts'
import { buildSharedCodexHarness } from './helpers/codex-fixtures.ts'

const describeE2e = requireE2eEnv()

describeE2e('codex e2e: file editing in the sandbox', () => {
  afterAll(async () => {
    await purgeE2eSandboxes()
  }, E2E_TEST_TIMEOUT_MS)

  test(
    'agent creates a new file and reads it back in the same session',
    async () => {
      const { agent } = buildSharedCodexHarness()
      const session = await agent.createSession()
      try {
        await agent.generate({
          session,
          prompt:
            'Use bash to create the file /workspace/notes.txt containing exactly the text "made by codex" (no quotes, no trailing newline). Confirm the file exists.',
        })
        const readback = await agent.generate({
          session,
          prompt:
            'Use bash to `cat /workspace/notes.txt` and reply with exactly the file contents and nothing else.',
        })
        expect(readback.text).toContain('made by codex')
      } finally {
        await session.destroy()
      }
    },
    E2E_TEST_TIMEOUT_MS,
  )

  test(
    'agent edits an existing JSON file and round-trips it through bash',
    async () => {
      const { agent } = buildSharedCodexHarness()
      const session = await agent.createSession()
      try {
        await agent.generate({
          session,
          prompt:
            'Use bash to write the JSON {"x":1} to /workspace/data.json (overwriting if present).',
        })
        await agent.generate({
          session,
          prompt:
            'Use bash with sed or python to update /workspace/data.json so that "x" is 42 instead of 1.',
        })
        const readback = await agent.generate({
          session,
          prompt: 'Use bash to print the contents of /workspace/data.json.',
        })
        expect(readback.text).toMatch(/"x"\s*:\s*42/)
      } finally {
        await session.destroy()
      }
    },
    E2E_TEST_TIMEOUT_MS,
  )
})
