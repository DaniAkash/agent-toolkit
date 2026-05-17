import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillManifest } from '../types.ts'

export const MANIFEST_FILE = '.manifest.json'
export const MANIFEST_TMP_PREFIX = '.manifest.json.tmp-'
let writeSeq = 0

export function emptyManifest(): SkillManifest {
  return { version: 1, skills: {} }
}

export async function loadManifest(
  workspaceDir: string,
): Promise<SkillManifest | null> {
  let raw: string
  try {
    raw = await readFile(join(workspaceDir, MANIFEST_FILE), 'utf8')
  } catch {
    return null
  }
  const parsed = JSON.parse(raw) as SkillManifest
  return migrate(parsed)
}

export async function saveManifest(
  workspaceDir: string,
  manifest: SkillManifest,
): Promise<void> {
  const seq = ++writeSeq
  const tmp = join(workspaceDir, `${MANIFEST_TMP_PREFIX}${process.pid}-${seq}`)
  const dst = join(workspaceDir, MANIFEST_FILE)
  await writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8')
  await rename(tmp, dst)
}

function migrate(manifest: SkillManifest): SkillManifest {
  if (manifest.version !== 1) {
    throw new Error(
      `Unsupported manifest version: ${(manifest as { version: unknown }).version}`,
    )
  }
  return manifest
}
