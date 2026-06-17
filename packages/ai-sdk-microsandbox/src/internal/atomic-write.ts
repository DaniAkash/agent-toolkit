import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Write `payload` into a fresh temporary directory, then commit it onto
 * `finalDir`. Failure-safe and race-tolerant:
 *
 * - Original `finalDir` (if any) is moved aside to a backup before the new
 *   directory takes its place. If the commit fails, the backup is restored.
 *   Worst case: a brief window during which neither the old nor the new
 *   `finalDir` is fully in place, but the directory is never silently
 *   emptied.
 * - Concurrent writers race on the rename; the loser cleans up its tmp dir
 *   and the winner's content is preserved (no `rm(finalDir)` step that
 *   could wipe another writer's committed result).
 *
 * Adapted from `vercel/eve`'s two-phase commit at `microsandbox-lifecycle.ts`
 * with an extra backup hop so a partial failure can never strand the caller
 * without `finalDir`.
 */
export async function atomicWriteIntoDirectory(input: {
  /** Final destination directory. */
  readonly finalDir: string
  /** File name to write under the final directory. */
  readonly filename: string
  /** UTF-8 string written to the file. */
  readonly payload: string
  /**
   * Optional side-effect run inside the tmp directory before commit — used
   * by the template-cache flow to write extra files alongside the metadata.
   */
  readonly prepare?: (tmpDir: string) => Promise<void>
}): Promise<void> {
  const parent = dirname(input.finalDir)
  await mkdir(parent, { recursive: true })
  const uniq = randomUUID()
  const tmpDir = `${input.finalDir}.${uniq}.tmp`
  const backupDir = `${input.finalDir}.${uniq}.bak`
  await mkdir(tmpDir, { recursive: true })
  try {
    await input.prepare?.(tmpDir)
    await writeFile(join(tmpDir, input.filename), input.payload, 'utf8')
    await commitWithBackup(tmpDir, input.finalDir, backupDir)
  } catch (error) {
    await rm(tmpDir, { force: true, recursive: true }).catch(() => {})
    throw error
  }
}

/**
 * Commit `tmpDir` onto `finalDir`. If `finalDir` already exists, move it
 * aside to `backupDir` first; on commit failure, restore from the backup.
 */
async function commitWithBackup(
  tmpDir: string,
  finalDir: string,
  backupDir: string,
): Promise<void> {
  // Try the easy path first — rename into a non-existent destination.
  try {
    await rename(tmpDir, finalDir)
    return
  } catch (error) {
    if (!isDestinationExistsError(error)) throw error
  }
  // Destination exists. Move it aside, commit, delete the backup.
  let backedUp = false
  try {
    await rename(finalDir, backupDir)
    backedUp = true
    await rename(tmpDir, finalDir)
    await rm(backupDir, { force: true, recursive: true }).catch(() => {})
  } catch (commitError) {
    if (backedUp) {
      // Best-effort restore so the caller still sees the original directory.
      await rename(backupDir, finalDir).catch(() => {})
    }
    throw commitError
  }
}

function isDestinationExistsError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'EPERM'
}
