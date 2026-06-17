import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { HarnessV1NetworkSandboxSession } from '@ai-sdk/harness'
import { createMicrosandbox } from '../../src/microsandbox-provider.ts'
import {
  DEFAULT_INTEGRATION_IMAGE,
  INTEGRATION_TEST_TIMEOUT_MS,
  requireIntegrationEnv,
} from './_setup.ts'

const describeIntegration = requireIntegrationEnv()

describeIntegration('microsandbox session: exec against a real VM', () => {
  let session: HarnessV1NetworkSandboxSession

  beforeAll(async () => {
    const provider = createMicrosandbox({
      image: DEFAULT_INTEGRATION_IMAGE,
      cpus: 1,
      memory: 512,
      workdir: '/workspace',
    })
    session = await provider.createSession()
  }, INTEGRATION_TEST_TIMEOUT_MS)

  afterAll(async () => {
    if (!session?.destroy) return
    try {
      await session.destroy()
    } catch {
      // Best-effort cleanup.
    }
  })

  test(
    'run() returns exit code, stdout, and stderr',
    async () => {
      const result = await session.run({ command: 'echo hi' })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('hi')
      expect(result.stderr).toBe('')
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )

  test(
    'run() honors workingDirectory',
    async () => {
      const result = await session.run({
        command: 'pwd',
        workingDirectory: '/tmp',
      })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('/tmp')
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )

  test(
    'run() honors env',
    async () => {
      const result = await session.run({
        command: 'echo $FOO',
        env: { FOO: 'bar-baz' },
      })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('bar-baz')
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )

  test(
    'run() reports non-zero exit without throwing',
    async () => {
      const result = await session.run({ command: 'exit 7' })
      expect(result.exitCode).toBe(7)
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )

  test(
    'spawn() returns a process that resolves wait() after exit',
    async () => {
      const proc = await session.spawn({
        command: 'bash -c "echo started; sleep 0.1; exit 3"',
      })
      const result = await proc.wait()
      expect(result.exitCode).toBe(3)
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )

  test(
    'spawn() + abort() cancels the in-flight process',
    async () => {
      const controller = new AbortController()
      const proc = await session.spawn({
        command: 'sleep 30',
        abortSignal: controller.signal,
      })
      // Abort after a small delay to let the process actually start.
      setTimeout(() => controller.abort(), 50)
      // Either wait() rejects (abort wired) or it resolves with a non-zero
      // exit. Both prove the process didn't run for 30s.
      const start = Date.now()
      try {
        await proc.wait()
      } catch {
        // expected
      }
      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(5_000)
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )

  test(
    'defaultWorkingDirectory reflects the configured workdir',
    async () => {
      expect(session.defaultWorkingDirectory).toBe('/workspace')
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )
})
