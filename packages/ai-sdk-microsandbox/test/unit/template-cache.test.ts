import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Experimental_SandboxSession } from '@ai-sdk/provider-utils'
import type { SandboxBuilder } from 'microsandbox'
import {
  _resetTemplateCacheForTests,
  TemplateCache,
  type TemplateMetadata,
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

describe('TemplateCache — first-call materialisation', () => {
  test('runs onFirstCreate once and snapshots the template', async () => {
    const { factory, history } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const cache = new TemplateCache({ cacheRoot, snapshotApi })

    let onFirstCreateCalls = 0
    const result = await cache.resolveTemplate({
      identity: 'claude-code-v1',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate: async () => {
        onFirstCreateCalls += 1
      },
    })

    expect(onFirstCreateCalls).toBe(1)
    expect(result.snapshotName).toMatch(/^ai-sdk-tpl-[0-9a-f]+$/)
    expect(snapshotApi.calls.some((c) => c.method === 'stopAndSnapshot')).toBe(
      true,
    )
    expect(history).toHaveLength(1)
    expect(history[0]?.name.startsWith('ai-sdk-tpl-src-')).toBe(true)
  })

  test('writes metadata.json under the templates directory', async () => {
    const { factory } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const cache = new TemplateCache({ cacheRoot, snapshotApi })

    const result = await cache.resolveTemplate({
      identity: 'claude-code-v1',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate: async () => {},
    })

    // Walk into the templates directory and find the single subdir.
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(join(cacheRoot, 'templates'))
    expect(entries).toHaveLength(1)
    const metadataRaw = await readFile(
      join(cacheRoot, 'templates', entries[0] ?? '', 'metadata.json'),
      'utf8',
    )
    const metadata = JSON.parse(metadataRaw) as TemplateMetadata
    expect(metadata.snapshotName).toBe(result.snapshotName)
    expect(metadata.identity).toBe('claude-code-v1')
    expect(metadata.version).toBe(1)
  })

  test('the session passed to onFirstCreate is a bare SandboxSession', async () => {
    const { factory } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const cache = new TemplateCache({ cacheRoot, snapshotApi })

    let received: Experimental_SandboxSession | undefined
    await cache.resolveTemplate({
      identity: 'foo',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate: async (session) => {
        received = session
      },
    })

    expect(received).toBeDefined()
    expect(typeof received?.run).toBe('function')
    // Network surface absent — `id` / `getPortUrl` / `stop` should not exist.
    expect((received as { id?: string }).id).toBeUndefined()
    expect((received as { getPortUrl?: unknown }).getPortUrl).toBeUndefined()
  })
})

describe('TemplateCache — second-call cache hit', () => {
  test('reuses the snapshot when in-memory cache has it', async () => {
    const { factory } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const cache = new TemplateCache({ cacheRoot, snapshotApi })

    let calls = 0
    const onFirstCreate = async () => {
      calls += 1
    }

    const a = await cache.resolveTemplate({
      identity: 'foo',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate,
    })
    const b = await cache.resolveTemplate({
      identity: 'foo',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate,
    })

    expect(calls).toBe(1)
    expect(a.snapshotName).toBe(b.snapshotName)
  })

  test('a fresh TemplateCache (new process simulation) reuses the disk metadata', async () => {
    const { factory } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()

    let calls = 0
    const onFirstCreate = async () => {
      calls += 1
    }

    const cacheA = new TemplateCache({ cacheRoot, snapshotApi })
    const a = await cacheA.resolveTemplate({
      identity: 'foo',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate,
    })

    // Simulate process restart — wipe the in-memory cache, create a fresh
    // TemplateCache instance pointing at the same root + snapshotApi.
    _resetTemplateCacheForTests()
    const cacheB = new TemplateCache({ cacheRoot, snapshotApi })
    const b = await cacheB.resolveTemplate({
      identity: 'foo',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate,
    })

    expect(calls).toBe(1) // onFirstCreate only ran on the first cache
    expect(a.snapshotName).toBe(b.snapshotName)
  })

  test('different identities mint distinct snapshots', async () => {
    const { factory } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const cache = new TemplateCache({ cacheRoot, snapshotApi })

    const a = await cache.resolveTemplate({
      identity: 'one',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate: async () => {},
    })
    const b = await cache.resolveTemplate({
      identity: 'two',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate: async () => {},
    })

    expect(a.snapshotName).not.toBe(b.snapshotName)
  })
})

describe('TemplateCache — concurrency', () => {
  test('two concurrent resolveTemplate calls share one onFirstCreate run', async () => {
    const { factory } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const cache = new TemplateCache({ cacheRoot, snapshotApi })

    let calls = 0
    const onFirstCreate = async () => {
      calls += 1
      // Yield to let the second resolveTemplate enter its in-flight check.
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    const [a, b] = await Promise.all([
      cache.resolveTemplate({
        identity: 'foo',
        settings: { image: 'debian' },
        builderFactory: factory,
        onFirstCreate,
      }),
      cache.resolveTemplate({
        identity: 'foo',
        settings: { image: 'debian' },
        builderFactory: factory,
        onFirstCreate,
      }),
    ])

    expect(calls).toBe(1)
    expect(a.snapshotName).toBe(b.snapshotName)
  })
})

describe('TemplateCache — invalidation', () => {
  test('settings change → rebuild', async () => {
    const { factory } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const cache = new TemplateCache({ cacheRoot, snapshotApi })

    let calls = 0
    const onFirstCreate = async () => {
      calls += 1
    }

    const a = await cache.resolveTemplate({
      identity: 'foo',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate,
    })
    const b = await cache.resolveTemplate({
      identity: 'foo',
      settings: { image: 'ubuntu' },
      builderFactory: factory,
      onFirstCreate,
    })

    expect(calls).toBe(2)
    expect(a.snapshotName).not.toBe(b.snapshotName)
  })

  test('stale snapshot (deleted out-of-band) → rebuild', async () => {
    const { factory } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const cache = new TemplateCache({ cacheRoot, snapshotApi })

    let calls = 0
    const onFirstCreate = async () => {
      calls += 1
    }

    const a = await cache.resolveTemplate({
      identity: 'foo',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate,
    })

    // Snapshot disappeared (manual deletion, host wipe, etc.).
    snapshotApi.forgetSnapshot(a.snapshotName)
    _resetTemplateCacheForTests()

    const cacheB = new TemplateCache({ cacheRoot, snapshotApi })
    await cacheB.resolveTemplate({
      identity: 'foo',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate,
    })

    expect(calls).toBe(2)
  })

  test('malformed metadata.json → treated as miss', async () => {
    const { factory } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const cache = new TemplateCache({ cacheRoot, snapshotApi })

    await cache.resolveTemplate({
      identity: 'foo',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate: async () => {},
    })

    // Corrupt the metadata.
    const { readdir, writeFile } = await import('node:fs/promises')
    const entries = await readdir(join(cacheRoot, 'templates'))
    const metadataPath = join(
      cacheRoot,
      'templates',
      entries[0] ?? '',
      'metadata.json',
    )
    await writeFile(metadataPath, 'not valid json', 'utf8')

    _resetTemplateCacheForTests()
    const cacheB = new TemplateCache({ cacheRoot, snapshotApi })

    let calls = 0
    await cacheB.resolveTemplate({
      identity: 'foo',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate: async () => {
        calls += 1
      },
    })

    expect(calls).toBe(1)
  })

  test('metadata version mismatch → treated as miss', async () => {
    const { factory } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const cache = new TemplateCache({ cacheRoot, snapshotApi })

    await cache.resolveTemplate({
      identity: 'foo',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate: async () => {},
    })

    const { readdir, readFile, writeFile } = await import('node:fs/promises')
    const entries = await readdir(join(cacheRoot, 'templates'))
    const metadataPath = join(
      cacheRoot,
      'templates',
      entries[0] ?? '',
      'metadata.json',
    )
    const original = JSON.parse(await readFile(metadataPath, 'utf8'))
    await writeFile(
      metadataPath,
      JSON.stringify({ ...original, version: 99 }),
      'utf8',
    )

    _resetTemplateCacheForTests()
    const cacheB = new TemplateCache({ cacheRoot, snapshotApi })

    let calls = 0
    await cacheB.resolveTemplate({
      identity: 'foo',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate: async () => {
        calls += 1
      },
    })

    expect(calls).toBe(1)
  })
})

describe('TemplateCache — failure handling', () => {
  test('onFirstCreate throw → no metadata written, next call retries', async () => {
    const { factory } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const cache = new TemplateCache({ cacheRoot, snapshotApi })

    await expect(
      cache.resolveTemplate({
        identity: 'foo',
        settings: { image: 'debian' },
        builderFactory: factory,
        onFirstCreate: async () => {
          throw new Error('bootstrap broke')
        },
      }),
    ).rejects.toThrow('bootstrap broke')

    // No metadata directory persisted.
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(join(cacheRoot, 'templates')).catch(() => [])
    expect(entries).toEqual([])

    // Next call retries from scratch.
    let calls = 0
    await cache.resolveTemplate({
      identity: 'foo',
      settings: { image: 'debian' },
      builderFactory: factory,
      onFirstCreate: async () => {
        calls += 1
      },
    })
    expect(calls).toBe(1)
  })

  test('pre-aborted signal → never invokes the builder', async () => {
    const { factory, history } = newBuilderFactory()
    const snapshotApi = new MockSnapshotApi()
    const cache = new TemplateCache({ cacheRoot, snapshotApi })

    const controller = new AbortController()
    controller.abort()

    await expect(
      cache.resolveTemplate({
        identity: 'foo',
        settings: { image: 'debian' },
        builderFactory: factory,
        onFirstCreate: async () => {},
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow()

    expect(history).toHaveLength(0)
  })
})
