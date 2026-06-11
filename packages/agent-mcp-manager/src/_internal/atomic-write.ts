import * as fsp from 'node:fs/promises'
import * as path from 'node:path'

/**
 * Write `data` to `file` via a sibling temp file + rename. Creates the
 * parent directory if needed. The rename is atomic on POSIX
 * filesystems; cross-platform "good enough" elsewhere.
 */
export async function atomicWriteFile(
  file: string,
  data: string,
): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    await fsp.writeFile(tmp, data, 'utf8')
    await fsp.rename(tmp, file)
  } catch (err) {
    // Best-effort cleanup of the temp file on failure.
    try {
      await fsp.unlink(tmp)
    } catch {
      // ignore
    }
    throw err
  }
}

export async function readFileOrEmpty(file: string): Promise<string> {
  try {
    return await fsp.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}
