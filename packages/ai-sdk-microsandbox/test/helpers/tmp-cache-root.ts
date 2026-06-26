import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Mint a per-test cache root under `os.tmpdir()`. Returns the path and a
 * cleanup function. Tests that touch the filesystem cache should use this
 * to avoid polluting the user's real cache directory.
 */
export async function createTmpCacheRoot(): Promise<{
  readonly path: string
  readonly cleanup: () => Promise<void>
}> {
  const path = join(tmpdir(), `ai-sdk-microsandbox-test-${randomUUID()}`)
  await mkdir(path, { recursive: true })
  return {
    path,
    cleanup: async () => {
      await rm(path, { force: true, recursive: true }).catch(() => {})
    },
  }
}
