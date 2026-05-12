import { spawn } from 'node:child_process'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseFrontmatter } from '../_vendor/frontmatter.ts'
import { sanitizeName } from '../_vendor/sanitize.ts'
import { SourceParseError } from '../errors.ts'
import type { AddSkillOptions, AddSkillResult, SkillSource } from '../types.ts'

interface DiscoveredSkill {
  name: string
  description: string
  sourcePath: string
}

/**
 * Resolve a `SkillSource` into a list of SKILL.md bundles on disk and
 * copy/symlink each one into the workspace. Returns the per-skill
 * outcome in our normalized `AddSkillResult` shape.
 */
export async function fetchSourceIntoWorkspace(
  parsed: SkillSource,
  workspaceDir: string,
  opts: AddSkillOptions,
): Promise<AddSkillResult> {
  const stagingDir = await resolveStagingDir(parsed)
  try {
    const discovered = await discoverSkills(stagingDir.path)
    const filter = opts.skillNames
    const allowAll = !filter || filter === '*'
    const chosen = allowAll
      ? discovered
      : discovered.filter((s) => (filter as string[]).includes(s.name))

    const added: AddSkillResult['added'] = []
    const skipped: AddSkillResult['skipped'] = []
    const failed: AddSkillResult['failed'] = []

    if (chosen.length === 0) {
      if (discovered.length === 0) {
        failed.push({
          name: '<source>',
          error: 'No SKILL.md found in source',
        })
      } else if (!allowAll) {
        for (const wanted of filter as string[]) {
          if (!discovered.some((s) => s.name === wanted)) {
            skipped.push({ name: wanted, reason: 'not found in source' })
          }
        }
      }
      return { added, skipped, failed }
    }

    for (const skill of chosen) {
      try {
        const sanitized = sanitizeName(skill.name)
        const destination = join(workspaceDir, sanitized)
        await rm(destination, { recursive: true, force: true })
        if (parsed.kind === 'local' && opts.localMode === 'symlink') {
          await symlink(skill.sourcePath, destination, 'dir')
        } else {
          await cp(skill.sourcePath, destination, { recursive: true })
        }
        added.push({
          name: skill.name,
          workspacePath: destination,
          description: skill.description,
        })
      } catch (err) {
        failed.push({
          name: skill.name,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return { added, skipped, failed }
  } finally {
    if (stagingDir.cleanup) await stagingDir.cleanup()
  }
}

async function resolveStagingDir(
  parsed: SkillSource,
): Promise<{ path: string; cleanup?: () => Promise<void> }> {
  if (parsed.kind === 'local') {
    return { path: parsed.path }
  }
  const tmp = await mkdtemp(join(tmpdir(), 'skills-manager-fetch-'))
  const url =
    parsed.kind === 'github'
      ? `https://github.com/${parsed.ownerRepo}.git`
      : parsed.url
  const ref = parsed.ref
  await gitClone(url, tmp, ref)
  return {
    path: tmp,
    cleanup: () => rm(tmp, { recursive: true, force: true }),
  }
}

function gitClone(url: string, dest: string, ref?: string): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const args = ref
      ? ['clone', '--depth=1', '--branch', ref, url, dest]
      : ['clone', '--depth=1', url, dest]
    const child = spawn('git', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.once('error', rejectP)
    child.once('close', (code) => {
      if (code === 0) resolveP()
      else
        rejectP(
          new SourceParseError(
            `git clone failed (exit ${code}): ${stderr.trim()}`,
          ),
        )
    })
  })
}

async function discoverSkills(root: string): Promise<DiscoveredSkill[]> {
  // A skill is any directory containing a SKILL.md file. The root itself
  // counts. We do not recurse into nested skills (a SKILL.md inside another
  // SKILL.md directory is treated as part of the outer bundle).
  const out: DiscoveredSkill[] = []
  await walk(root, root)
  return out

  async function walk(dir: string, baseRoot: string): Promise<void> {
    const skillMd = join(dir, 'SKILL.md')
    let isSkillDir = false
    try {
      // `lstat` first — a SKILL.md symlinked outside the source tree is a
      // CWE-22 / RCE-adjacent risk (a malicious remote repo could point
      // SKILL.md at `/etc/passwd` or similar). Reject symlinked SKILL.md
      // outright; we don't read or copy them. Sibling dirs are still walked
      // below so legitimate adjacent skills aren't lost.
      const ls = await lstat(skillMd)
      if (!ls.isSymbolicLink()) {
        const s = await stat(skillMd)
        isSkillDir = s.isFile()
      }
    } catch {
      isSkillDir = false
    }
    if (isSkillDir) {
      const raw = await readFile(skillMd, 'utf8')
      const { data } = parseFrontmatter(raw)
      const name =
        typeof data.name === 'string' && data.name.trim().length > 0
          ? data.name.trim()
          : dir === baseRoot
            ? 'unnamed-skill'
            : dir.slice(baseRoot.length + 1) || 'unnamed-skill'
      const description =
        typeof data.description === 'string' ? data.description : ''
      out.push({ name, description, sourcePath: dir })
      return // do not recurse below a skill directory
    }
    let entries: Array<{ name: string; isDirectory(): boolean }> = []
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      await walk(join(dir, e.name), baseRoot)
    }
  }
}

// Re-exported so a possible future caller can avoid pulling the whole
// manager just to ensure the workspace is created.
export async function ensureWorkspaceDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}
