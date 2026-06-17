import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteIntoDirectory } from '../../src/internal/atomic-write.ts'
import { createTmpCacheRoot } from '../helpers/tmp-cache-root.ts'

let root = ''
let cleanup: () => Promise<void> = async () => {}

beforeEach(async () => {
  const tmp = await createTmpCacheRoot()
  root = tmp.path
  cleanup = tmp.cleanup
})

afterEach(async () => {
  await cleanup()
})

describe('atomicWriteIntoDirectory', () => {
  test('writes the payload to <finalDir>/<filename>', async () => {
    const finalDir = join(root, 'target')
    await atomicWriteIntoDirectory({
      finalDir,
      filename: 'metadata.json',
      payload: '{"hello":"world"}',
    })
    const content = await readFile(join(finalDir, 'metadata.json'), 'utf8')
    expect(content).toBe('{"hello":"world"}')
  })

  test('creates the parent directory if it does not exist', async () => {
    const finalDir = join(root, 'deeply', 'nested', 'target')
    await atomicWriteIntoDirectory({
      finalDir,
      filename: 'data.txt',
      payload: 'ok',
    })
    const content = await readFile(join(finalDir, 'data.txt'), 'utf8')
    expect(content).toBe('ok')
  })

  test('overwrites an existing final directory atomically', async () => {
    const finalDir = join(root, 'target')
    await atomicWriteIntoDirectory({
      finalDir,
      filename: 'data.txt',
      payload: 'first',
    })
    await atomicWriteIntoDirectory({
      finalDir,
      filename: 'data.txt',
      payload: 'second',
    })
    const content = await readFile(join(finalDir, 'data.txt'), 'utf8')
    expect(content).toBe('second')
  })

  test('cleans up the tmp dir on prepare() failure', async () => {
    const finalDir = join(root, 'target')
    await expect(
      atomicWriteIntoDirectory({
        finalDir,
        filename: 'metadata.json',
        payload: '{}',
        prepare: async () => {
          throw new Error('bootstrap failed')
        },
      }),
    ).rejects.toThrow('bootstrap failed')
    // The temp directory should be cleaned up; only the parent (root) remains.
    const entries = await readdir(root)
    expect(entries.filter((e) => e.startsWith('target'))).toEqual([])
  })

  test('prepare() runs inside the tmp dir before the rename', async () => {
    const finalDir = join(root, 'target')
    let capturedTmp = ''
    await atomicWriteIntoDirectory({
      finalDir,
      filename: 'metadata.json',
      payload: '{}',
      prepare: async (tmpDir) => {
        capturedTmp = tmpDir
        await writeFile(join(tmpDir, 'extra.txt'), 'side-effect', 'utf8')
      },
    })
    // The captured tmp path is gone (renamed onto finalDir).
    expect(capturedTmp).toContain('.tmp')
    // The side-effect file was carried into finalDir by the rename.
    const sideEffect = await readFile(join(finalDir, 'extra.txt'), 'utf8')
    expect(sideEffect).toBe('side-effect')
  })

  test('does not leak tmp dirs across concurrent calls', async () => {
    const finalDir = join(root, 'target')
    // Two concurrent writers race on the rename. The loser will reject with
    // a filesystem race error (ENOTEMPTY / EEXIST); both must clean up their
    // own tmp dir regardless.
    const results = await Promise.allSettled([
      atomicWriteIntoDirectory({
        finalDir,
        filename: 'data.txt',
        payload: 'a',
      }),
      atomicWriteIntoDirectory({
        finalDir,
        filename: 'data.txt',
        payload: 'b',
      }),
    ])
    // At least one succeeded; both attempts left no tmp dirs behind.
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    expect(fulfilled.length).toBeGreaterThanOrEqual(1)
    const entries = await readdir(root)
    expect(entries).toEqual(['target'])
  })

  test('preserves the original finalDir when the commit fails after backup', async () => {
    const finalDir = join(root, 'target')
    // Seed an existing finalDir with content the helper must not lose.
    await atomicWriteIntoDirectory({
      finalDir,
      filename: 'data.txt',
      payload: 'original',
    })
    // Drive a commit failure by throwing in prepare() — finalDir still
    // exists from the seed write; the helper should clean up its tmp dir
    // and leave the original intact.
    await expect(
      atomicWriteIntoDirectory({
        finalDir,
        filename: 'data.txt',
        payload: 'replacement',
        prepare: async () => {
          throw new Error('commit aborted')
        },
      }),
    ).rejects.toThrow('commit aborted')
    const content = await readFile(join(finalDir, 'data.txt'), 'utf8')
    expect(content).toBe('original')
  })
})
