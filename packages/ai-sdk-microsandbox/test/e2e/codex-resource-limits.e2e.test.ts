import { afterAll, afterEach, expect, test } from 'bun:test'
import { E2E_TEST_TIMEOUT_MS, requireE2eEnv } from './_setup.ts'
import { purgeE2eSandboxes, purgeHarnessForks } from './helpers/cleanup.ts'
import { buildSharedCodexHarness } from './helpers/codex-fixtures.ts'

const describeE2e = requireE2eEnv()

describeE2e('codex e2e: resource limits and configuration matrix', () => {
  afterEach(async () => {
    await purgeHarnessForks()
  }, E2E_TEST_TIMEOUT_MS)
  afterAll(async () => {
    await purgeE2eSandboxes()
  }, E2E_TEST_TIMEOUT_MS)

  test(
    'agent honors a non-default workdir',
    async () => {
      const { agent } = buildSharedCodexHarness({ workdir: '/var' })
      const session = await agent.createSession()
      try {
        const result = await agent.generate({
          session,
          prompt:
            'Use bash to print the absolute path of the current working directory (pwd).',
        })
        expect(result.text).toContain('/var')
      } finally {
        await session.destroy()
      }
    },
    E2E_TEST_TIMEOUT_MS,
  )

  test(
    'agent sees env vars passed via the sandbox env setting',
    async () => {
      const { agent } = buildSharedCodexHarness({
        env: { E2E_CUSTOM: 'sentinel-value' },
      })
      const session = await agent.createSession()
      try {
        const result = await agent.generate({
          session,
          prompt:
            'Use bash to `echo $E2E_CUSTOM`. Then in your response include the value bash printed.',
        })
        expect(result.text).toContain('sentinel-value')
      } finally {
        await session.destroy()
      }
    },
    E2E_TEST_TIMEOUT_MS,
  )

  test(
    'higher cpus setting is honored inside the microVM (nproc reports it)',
    async () => {
      const { agent } = buildSharedCodexHarness({ cpus: 2, memory: 1024 })
      const session = await agent.createSession()
      try {
        const result = await agent.generate({
          session,
          prompt:
            'Use bash to `nproc` and include the exact number it prints in your response.',
        })
        expect(result.text).toMatch(/\b[12]\b/)
      } finally {
        await session.destroy()
      }
    },
    E2E_TEST_TIMEOUT_MS,
  )
})
