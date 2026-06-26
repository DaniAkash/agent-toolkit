import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { SandboxBuilder } from 'microsandbox'
import { MicrosandboxNetworkSandboxSession } from '../../src/microsandbox-network-sandbox-session.ts'
import { MicrosandboxProvider } from '../../src/microsandbox-provider.ts'
import {
  _resetTemplateCacheForTests,
  TemplateCache,
} from '../../src/template-cache.ts'
import { MockSandbox } from '../helpers/mock-sandbox.ts'
import { MockSandboxBuilder } from '../helpers/mock-sandbox-builder.ts'
import { MockSnapshotApi } from '../helpers/mock-snapshot-api.ts'
import { createTmpCacheRoot } from '../helpers/tmp-cache-root.ts'

interface BuilderFactoryHarness {
  factory: (name: string) => SandboxBuilder
  history: Array<{
    name: string
    builder: MockSandboxBuilder
    sandbox: MockSandbox
  }>
}

function newBuilderFactory(): BuilderFactoryHarness {
  const history: BuilderFactoryHarness['history'] = []
  const factory = (name: string): SandboxBuilder => {
    const sandbox = new MockSandbox({ name })
    const builder = new MockSandboxBuilder()
    builder.create = async () => {
      builder.calls.push({ method: 'create' })
      return sandbox
    }
    history.push({ name, builder, sandbox })
    return builder.asSandboxBuilder()
  }
  return { factory, history }
}

let cacheRoot = ''
let cleanup: () => Promise<void> = async () => {}

beforeEach(async () => {
  _resetTemplateCacheForTests()
  const tmp = await createTmpCacheRoot()
  cacheRoot = tmp.path
  cleanup = tmp.cleanup
})

afterEach(async () => {
  await cleanup()
})

function buildProvider(input: {
  factory: BuilderFactoryHarness['factory']
  snapshotApi: MockSnapshotApi
}): MicrosandboxProvider {
  return new MicrosandboxProvider(
    { image: 'debian', cpus: 2, memory: 1024, workdir: '/work' },
    {
      builderFactory: input.factory,
      templateCache: new TemplateCache({
        cacheRoot,
        snapshotApi: input.snapshotApi,
      }),
    },
  )
}

describe('MicrosandboxProvider — identity branch', () => {
  test('first call runs onFirstCreate, snapshots, and forks', async () => {
    const { factory, history } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const provider = buildProvider({ factory, snapshotApi })

    let calls = 0
    const session = await provider.createSession({
      identity: 'claude-code-v1',
      onFirstCreate: async () => {
        calls += 1
      },
    })

    expect(calls).toBe(1)
    expect(session).toBeInstanceOf(MicrosandboxNetworkSandboxSession)
    // Two sandboxes built: the template, and the fork.
    expect(history).toHaveLength(2)
    expect(history[0]?.name.startsWith('ai-sdk-tpl-src-')).toBe(true)
    expect(history[1]?.name.startsWith('ai-sdk-harness-')).toBe(true)
    // The fork builder called fromSnapshot() with the snapshot we captured.
    const forkCalls = history[1]?.builder.calls ?? []
    expect(forkCalls.some((c) => c.method === 'fromSnapshot')).toBe(true)
  })

  test('two sessions with same identity share one onFirstCreate run', async () => {
    const { factory } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const provider = buildProvider({ factory, snapshotApi })

    let calls = 0
    const onFirstCreate = async () => {
      calls += 1
    }

    await provider.createSession({ identity: 'foo', onFirstCreate })
    await provider.createSession({ identity: 'foo', onFirstCreate })

    expect(calls).toBe(1)
  })

  test('forked session owns its own lifecycle', async () => {
    const { factory, history } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const provider = buildProvider({ factory, snapshotApi })

    const session = await provider.createSession({
      identity: 'foo',
      onFirstCreate: async () => {},
    })

    await session.stop()
    // The fork (second sandbox in history) had stop() called.
    expect(history[1]?.sandbox.stopCalls).toBe(1)
  })

  test('sessionId is applied to the fork name, not the template', async () => {
    const { factory, history } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const provider = buildProvider({ factory, snapshotApi })

    await provider.createSession({
      identity: 'foo',
      sessionId: 'turn-7',
      onFirstCreate: async () => {},
    })

    expect(history[1]?.name).toBe('ai-sdk-harness-turn-7')
    // The template name is identity-derived, not sessionId-derived.
    expect(history[0]?.name).not.toContain('turn-7')
  })

  test('fork builder skips image() (snapshot already pins it)', async () => {
    const { factory, history } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const provider = buildProvider({ factory, snapshotApi })

    await provider.createSession({
      identity: 'foo',
      onFirstCreate: async () => {},
    })

    const forkCalls = history[1]?.builder.calls ?? []
    expect(forkCalls.some((c) => c.method === 'image')).toBe(false)
    expect(forkCalls.some((c) => c.method === 'fromSnapshot')).toBe(true)
  })

  test('pre-aborted signal short-circuits before touching the cache', async () => {
    const { factory, history } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const provider = buildProvider({ factory, snapshotApi })

    const controller = new AbortController()
    controller.abort()
    await expect(
      provider.createSession({
        identity: 'foo',
        onFirstCreate: async () => {},
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow()

    expect(history).toHaveLength(0)
    expect(snapshotApi.calls.some((c) => c.method === 'stopAndSnapshot')).toBe(
      false,
    )
  })

  test('wrap mode + identity → identity is ignored (no template touched)', async () => {
    const callerSandbox = new MockSandbox({ name: 'caller-vm' })
    const snapshotApi = new MockSnapshotApi()
    const provider = new MicrosandboxProvider(
      // biome-ignore lint/suspicious/noExplicitAny: structural cast for wrap-mode settings
      { sandbox: callerSandbox as any },
      {
        templateCache: new TemplateCache({
          cacheRoot,
          snapshotApi,
        }),
      },
    )

    let calls = 0
    const session = await provider.createSession({
      identity: 'irrelevant',
      onFirstCreate: async () => {
        calls += 1
      },
    })

    expect(calls).toBe(0)
    expect(session.id).toBe('caller-vm')
    expect(snapshotApi.calls.some((c) => c.method === 'stopAndSnapshot')).toBe(
      false,
    )
  })
})
