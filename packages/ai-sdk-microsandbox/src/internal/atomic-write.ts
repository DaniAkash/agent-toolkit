import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Write `payload` into a fresh temporary directory, then atomically rename
 * that directory onto `finalDir`. Mirrors the two-phase commit pattern from
 * `vercel/eve` (`microsandbox-lifecycle.ts:140-148`) — concurrent writers
 * race on the rename; whichever process commits first wins, others delete
 * their losing tmp directory.
 *
 * On success, `finalDir/{filename}` exists with the new payload and any
 * previous contents of `finalDir` are gone (the rename overwrites).
 *
 * On failure, the tmp dir is cleaned up and the original `finalDir`
 * (if any) is untouched.
 */
export async function atomicWriteIntoDirectory(input: {
  /** Final destination directory. Renamed onto from the tmp dir. */
  readonly finalDir: string
  /** File name to write under the final directory. */
  readonly filename: string
  /** UTF-8 string written to the file. */
  readonly payload: string
  /**
   * Optional side-effect run inside the tmp directory before rename — used
   * by the template-cache flow to write metadata + capture snapshot name
   * derived from the tmp path. The receiver gets the absolute tmp dir.
   */
  readonly prepare?: (tmpDir: string) => Promise<void>
}): Promise<void> {
  const parent = dirname(input.finalDir)
  await mkdir(parent, { recursive: true })
  const tmpDir = `${input.finalDir}.${randomUUID()}.tmp`
  await mkdir(tmpDir, { recursive: true })
  try {
    await input.prepare?.(tmpDir)
    await writeFile(`${tmpDir}/${input.filename}`, input.payload, 'utf8')
    await rm(input.finalDir, { force: true, recursive: true })
    await rename(tmpDir, input.finalDir)
  } catch (error) {
    await rm(tmpDir, { force: true, recursive: true }).catch(() => {
      // Best-effort cleanup; the underlying error is what matters.
    })
    throw error
  }
}
