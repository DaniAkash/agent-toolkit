import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { HarnessV1NetworkSandboxSession } from '@ai-sdk/harness'
import { createMicrosandbox } from '../../src/microsandbox-provider.ts'
import {
  DEFAULT_INTEGRATION_IMAGE,
  INTEGRATION_TEST_TIMEOUT_MS,
  requireIntegrationEnv,
} from './_setup.ts'

const describeIntegration = requireIntegrationEnv()

describeIntegration('microsandbox session — fs against a real VM', () => {
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
    await session?.destroy().catch(() => undefined)
  })

  test(
    'writeTextFile then readTextFile round-trips utf-8 content',
    async () => {
      await session.writeTextFile({
        path: '/workspace/hello.txt',
        content: 'hello, world',
      })
      const text = await session.readTextFile({ path: '/workspace/hello.txt' })
      expect(text).toBe('hello, world')
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )

  test(
    'writeBinaryFile auto-creates parent directories',
    async () => {
      const payload = new TextEncoder().encode('deep nested data')
      await session.writeBinaryFile({
        path: '/workspace/a/b/c/d.txt',
        content: payload,
      })
      const bytes = await session.readBinaryFile({
        path: '/workspace/a/b/c/d.txt',
      })
      expect(bytes).not.toBeNull()
      expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toBe(
        'deep nested data',
      )
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )

  test(
    'readBinaryFile returns null for a missing file (isFileNotFoundError matched)',
    async () => {
      const bytes = await session.readBinaryFile({
        path: '/workspace/does-not-exist.txt',
      })
      expect(bytes).toBeNull()
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )

  test(
    'readTextFile encoding param honored for latin1',
    async () => {
      const latin1Buf = Buffer.from('\xe9clair', 'latin1') // é + clair
      await session.writeBinaryFile({
        path: '/workspace/latin1.txt',
        content: new Uint8Array(
          latin1Buf.buffer,
          latin1Buf.byteOffset,
          latin1Buf.byteLength,
        ),
      })
      const text = await session.readTextFile({
        path: '/workspace/latin1.txt',
        encoding: 'latin1',
      })
      expect(text).toBe('éclair')
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )

  test(
    'readTextFile line-range slicing returns the requested lines',
    async () => {
      await session.writeTextFile({
        path: '/workspace/lines.txt',
        content: 'one\ntwo\nthree\nfour\nfive',
      })
      const slice = await session.readTextFile({
        path: '/workspace/lines.txt',
        startLine: 2,
        endLine: 4,
      })
      expect(slice).toBe('two\nthree\nfour')
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )

  test(
    'large file (1 MB) round-trips through collectStream + write',
    async () => {
      const oneMb = new Uint8Array(1024 * 1024)
      for (let i = 0; i < oneMb.length; i++) oneMb[i] = i % 256
      await session.writeBinaryFile({
        path: '/workspace/big.bin',
        content: oneMb,
      })
      const back = await session.readBinaryFile({ path: '/workspace/big.bin' })
      expect(back).not.toBeNull()
      expect(back?.byteLength).toBe(oneMb.byteLength)
      expect(back?.[0]).toBe(0)
      expect(back?.[255]).toBe(255)
      expect(back?.[256]).toBe(0)
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )

  test(
    'restricted() session can read and write but cannot stop the sandbox',
    async () => {
      const restricted = session.restricted()
      await restricted.writeTextFile({
        path: '/workspace/restricted.txt',
        content: 'r',
      })
      const text = await restricted.readTextFile({
        path: '/workspace/restricted.txt',
      })
      expect(text).toBe('r')
      // The restricted view has no stop/destroy surface; typecheck plus a
      // shape check is enough.
      expect('stop' in restricted).toBe(false)
      expect('destroy' in restricted).toBe(false)
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )
})
