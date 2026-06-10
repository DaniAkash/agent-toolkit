import * as fsp from 'node:fs/promises'
import * as path from 'node:path'

import type { ServerManifest } from '../types.ts'

const EMPTY_MANIFEST: ServerManifest = { version: 1, servers: {} }

export function emptyManifest(): ServerManifest {
  return { version: 1, servers: {} }
}

export function manifestPath(workspaceDir: string): string {
  return path.join(workspaceDir, 'manifest.json')
}

export async function readManifest(
  workspaceDir: string,
): Promise<ServerManifest> {
  const file = manifestPath(workspaceDir)
  let raw: string
  try {
    raw = await fsp.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyManifest()
    throw err
  }
  if (!raw.trim()) return emptyManifest()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyManifest()
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as ServerManifest).version !== 1 ||
    typeof (parsed as ServerManifest).servers !== 'object' ||
    (parsed as ServerManifest).servers === null
  ) {
    return emptyManifest()
  }
  return parsed as ServerManifest
}

export async function writeManifest(
  workspaceDir: string,
  manifest: ServerManifest,
): Promise<void> {
  const file = manifestPath(workspaceDir)
  await fsp.mkdir(workspaceDir, { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fsp.writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await fsp.rename(tmp, file)
}

export { EMPTY_MANIFEST }
