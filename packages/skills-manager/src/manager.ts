import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'node:path'
import {
  ensureWorkspaceDir,
  fetchSourceIntoWorkspace,
} from './_internal/fetch-source.ts'
import {
  emptyManifest,
  loadManifest,
  MANIFEST_FILE,
  MANIFEST_TMP_PREFIX,
  saveManifest,
} from './_internal/manifest.ts'
import { agents as agentsCatalog } from './_vendor/agents.ts'
import { parseFrontmatter } from './_vendor/frontmatter.ts'
import { sanitizeName } from './_vendor/sanitize.ts'
import { resolveAgentSkillsDir } from './agents.ts'
import { ForeignPathError, SkillNotFoundError } from './errors.ts'
import { parseSourceInput } from './source.ts'
import type {
  AddSkillOptions,
  AddSkillResult,
  AgentId,
  InstalledSkill,
  LinkSkillOptions,
  LinkSkillResult,
  ListLinksOptions,
  ListSkillsOptions,
  ManifestSkillEntry,
  RemoveSkillOptions,
  RescanOptions,
  RescanResult,
  SkillLink,
  SkillManifest,
  SkillsManagerOptions,
  UnlinkSkillOptions,
  UnlinkSkillResult,
} from './types.ts'

const DEFAULT_WORKSPACE = join(homedir(), '.skills')

export interface SkillsManager {
  readonly workspaceDir: string

  add(opts: AddSkillOptions): Promise<AddSkillResult>
  link(opts: LinkSkillOptions): Promise<LinkSkillResult>
  unlink(opts: UnlinkSkillOptions): Promise<UnlinkSkillResult>
  remove(opts: RemoveSkillOptions): Promise<void>
  removeWithLinks(opts: RemoveSkillOptions): Promise<{ unlinked: SkillLink[] }>
  listSkills(opts?: ListSkillsOptions): Promise<InstalledSkill[]>
  listLinks(opts?: ListLinksOptions): Promise<SkillLink[]>
  rescan(opts?: RescanOptions): Promise<RescanResult>
}

export function createSkillsManager(
  opts: SkillsManagerOptions = {},
): SkillsManager {
  const workspaceDir = resolve(opts.workspaceDir ?? DEFAULT_WORKSPACE)
  const overrides = opts.agentSkillsDirs ?? {}
  const agentDirFor = (agent: AgentId): string =>
    overrides[agent] ?? resolveAgentSkillsDir(agent)
  let writeQueue: Promise<unknown> = Promise.resolve()
  const enqueueWrite = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = writeQueue.then(fn, fn)
    writeQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  async function readManifest(): Promise<SkillManifest> {
    return (await loadManifest(workspaceDir)) ?? emptyManifest()
  }

  async function declaredTarget(linkPath: string): Promise<string | null> {
    let s: Awaited<ReturnType<typeof lstat>>
    try {
      s = await lstat(linkPath)
    } catch {
      return null
    }
    if (!s.isSymbolicLink()) return null
    let target: string
    try {
      target = await readlink(linkPath)
    } catch {
      return null
    }
    return isAbsolute(target)
      ? normalize(target)
      : normalize(join(dirname(linkPath), target))
  }

  // Windows-safe containment check. `path.relative` returns "" when the
  // target IS the workspace, or a relative path that doesn't start with
  // ".." when it's a descendant. Anything else (absolute path, "..", etc.)
  // means the target sits outside the workspace.
  function declaresIntoWorkspace(absoluteTarget: string): boolean {
    const rel = relative(workspaceDir, absoluteTarget)
    if (rel === '') return true
    if (rel.startsWith('..')) return false
    return !isAbsolute(rel) && !rel.startsWith(`..${sep}`)
  }

  function isReservedManifestEntry(name: string): boolean {
    return name === MANIFEST_FILE || name.startsWith(MANIFEST_TMP_PREFIX)
  }

  /**
   * Build a manifest entry for a skill that already exists on disk but
   * isn't recorded (e.g. `link()` called before `add()`). We read SKILL.md
   * so the synthesized entry carries a real name/description instead of
   * placeholders.
   */
  async function synthesizeEntry(
    skillName: string,
    skillDir: string,
    now: string,
  ): Promise<ManifestSkillEntry> {
    const meta = await readSkillMd(skillDir)
    return {
      name: meta?.name || skillName,
      description: meta?.description || '',
      source: { kind: 'local', path: skillDir },
      addedAt: now,
      links: {},
    }
  }

  async function fileExists(path: string): Promise<boolean> {
    try {
      await lstat(path)
      return true
    } catch {
      return false
    }
  }

  async function readSkillMd(
    workspacePath: string,
  ): Promise<{ name: string; description: string } | null> {
    let raw: string
    try {
      raw = await readFile(join(workspacePath, 'SKILL.md'), 'utf8')
    } catch {
      return null
    }
    const { data } = parseFrontmatter(raw)
    return {
      name: typeof data.name === 'string' ? data.name : '',
      description: typeof data.description === 'string' ? data.description : '',
    }
  }

  const manager: SkillsManager = {
    workspaceDir,

    async add(addOpts) {
      await ensureWorkspaceDir(workspaceDir)
      const parsed = parseSourceInput(addOpts.source)
      const fetched = await fetchSourceIntoWorkspace(
        parsed,
        workspaceDir,
        addOpts,
      )
      return await enqueueWrite(async () => {
        const manifest = await readManifest()
        const now = new Date().toISOString()
        for (const entry of fetched.added) {
          const dirName = sanitizeName(entry.name)
          const prior = manifest.skills[dirName]
          manifest.skills[dirName] = {
            name: entry.name,
            description: entry.description,
            source: parsed,
            addedAt: prior?.addedAt ?? now,
            links: prior?.links ?? {},
          }
        }
        await saveManifest(workspaceDir, manifest)
        return fetched
      })
    },

    async link(linkOpts) {
      const { skillName, agent } = linkOpts
      const dirName = sanitizeName(skillName)
      const skillDir = join(workspaceDir, dirName)
      const agentDir = linkOpts.agentSkillsDir ?? agentDirFor(agent)
      const linkPath = join(agentDir, dirName)

      try {
        await lstat(join(skillDir, 'SKILL.md'))
      } catch {
        throw new SkillNotFoundError(`Skill not in workspace: ${skillName}`)
      }

      // All filesystem mutations + manifest write run inside the queue so
      // concurrent link() calls on the same instance can't race on
      // symlink() / rm() (e.g. EEXIST).
      return await enqueueWrite(async () => {
        const declared = await declaredTarget(linkPath)
        if (declared === null) {
          let foreign = false
          try {
            const s = await lstat(linkPath)
            foreign = !s.isSymbolicLink()
          } catch {
            /* absent */
          }
          if (foreign) {
            throw new ForeignPathError(
              `Refusing to overwrite non-symlink at ${linkPath}`,
            )
          }
        } else if (declared === skillDir) {
          const manifest = await readManifest()
          const entry = manifest.skills[dirName]
          if (entry?.links[agent]) {
            return { skillName, agent, linkPath, created: false }
          }
          const now = new Date().toISOString()
          const baseEntry =
            entry ?? (await synthesizeEntry(skillName, skillDir, now))
          baseEntry.links[agent] = {
            linkPath,
            workspacePath: skillDir,
            createdAt: now,
          }
          manifest.skills[dirName] = baseEntry
          await saveManifest(workspaceDir, manifest)
          return { skillName, agent, linkPath, created: false }
        } else if (declaresIntoWorkspace(declared)) {
          // Stale link pointing at a different workspace dir — replace.
          await rm(linkPath, { force: true })
        } else {
          throw new ForeignPathError(
            `Symlink at ${linkPath} points outside workspace`,
          )
        }

        await mkdir(dirname(linkPath), { recursive: true })
        await symlink(skillDir, linkPath, 'dir')

        const manifest = await readManifest()
        const now = new Date().toISOString()
        const entry =
          manifest.skills[dirName] ??
          (await synthesizeEntry(skillName, skillDir, now))
        entry.links[agent] = {
          linkPath,
          workspacePath: skillDir,
          createdAt: now,
        }
        manifest.skills[dirName] = entry
        await saveManifest(workspaceDir, manifest)
        return { skillName, agent, linkPath, created: true }
      })
    },

    async unlink(unlinkOpts) {
      const { skillName, agent } = unlinkOpts
      const dirName = sanitizeName(skillName)
      const agentDir = unlinkOpts.agentSkillsDir ?? agentDirFor(agent)
      const linkPath = join(agentDir, dirName)

      return await enqueueWrite(async () => {
        const manifest = await readManifest()
        const entry = manifest.skills[dirName]
        const recorded = entry?.links[agent]

        if (!recorded) {
          const declared = await declaredTarget(linkPath)
          if (declared === null) {
            let foreign = false
            try {
              const s = await lstat(linkPath)
              foreign = !s.isSymbolicLink()
            } catch {
              /* absent */
            }
            return { linkPath, removed: false, foreign: foreign || undefined }
          }
          if (declaresIntoWorkspace(declared)) {
            return { linkPath, removed: false, unmanaged: true }
          }
          return { linkPath, removed: false, foreign: true }
        }

        const declared = await declaredTarget(linkPath)
        if (declared !== null && declared === recorded.workspacePath) {
          await rm(linkPath, { force: true })
          delete entry.links[agent]
          await saveManifest(workspaceDir, manifest)
          return { linkPath, removed: true }
        }
        if (declared === null) {
          let stillSymlink = false
          let foreign = false
          try {
            const s = await lstat(linkPath)
            stillSymlink = s.isSymbolicLink()
            foreign = !stillSymlink
          } catch {
            /* absent */
          }
          delete entry.links[agent]
          await saveManifest(workspaceDir, manifest)
          if (stillSymlink) {
            await rm(linkPath, { force: true })
            return { linkPath, removed: true }
          }
          return { linkPath, removed: false, foreign: foreign || undefined }
        }
        // Drifted: symlink points elsewhere.
        delete entry.links[agent]
        await saveManifest(workspaceDir, manifest)
        if (declaresIntoWorkspace(declared)) {
          await rm(linkPath, { force: true })
          return { linkPath, removed: true }
        }
        return { linkPath, removed: false, foreign: true }
      })
    },

    async remove(removeOpts) {
      const dirName = sanitizeName(removeOpts.skillName)
      const dir = join(workspaceDir, dirName)
      // Inside the queue so concurrent remove()/add() calls don't race
      // on the same workspace dir.
      await enqueueWrite(async () => {
        await rm(dir, { recursive: true, force: true })
        const manifest = await readManifest()
        delete manifest.skills[dirName]
        await saveManifest(workspaceDir, manifest)
      })
    },

    async removeWithLinks(removeOpts) {
      const links = await manager.listLinks({
        skillNames: [removeOpts.skillName],
      })
      const unlinked: SkillLink[] = []
      for (const link of links) {
        if (link.unmanaged) continue
        const res = await manager.unlink({
          skillName: link.skillName,
          agent: link.agent,
        })
        if (res.removed) unlinked.push(link)
      }
      await manager.remove({ skillName: removeOpts.skillName })
      return { unlinked }
    },

    async listSkills(listOpts = {}) {
      const manifest = await readManifest()
      const out: InstalledSkill[] = []
      const known = new Set<string>()

      for (const [dirName, entry] of Object.entries(manifest.skills)) {
        known.add(dirName)
        const workspacePath = join(workspaceDir, dirName)
        let broken = false
        try {
          await lstat(join(workspacePath, 'SKILL.md'))
        } catch {
          broken = true
        }
        out.push({
          name: entry.name,
          description: entry.description,
          workspacePath,
          source: entry.source,
          addedAt: entry.addedAt,
          broken: broken || undefined,
        })
      }

      if (!listOpts.scanUnmanaged) return out

      let entries: string[] = []
      try {
        entries = await readdir(workspaceDir)
      } catch {
        /* empty */
      }
      for (const name of entries) {
        if (isReservedManifestEntry(name)) continue
        if (known.has(name)) continue
        const workspacePath = join(workspaceDir, name)
        const meta = await readSkillMd(workspacePath)
        if (!meta) continue
        out.push({
          name: meta.name || name,
          description: meta.description,
          workspacePath,
          unmanaged: true,
        })
      }
      return out
    },

    async listLinks(listOpts = {}) {
      const manifest = await readManifest()
      const skillFilter = listOpts.skillNames
        ? new Set(listOpts.skillNames.map(sanitizeName))
        : null
      const agentFilter = listOpts.agents ? new Set(listOpts.agents) : null
      const out: SkillLink[] = []
      const seen = new Set<string>()

      for (const [dirName, entry] of Object.entries(manifest.skills)) {
        if (skillFilter && !skillFilter.has(dirName)) continue
        for (const [agent, link] of Object.entries(entry.links) as Array<
          [AgentId, NonNullable<ManifestSkillEntry['links'][AgentId]>]
        >) {
          if (agentFilter && !agentFilter.has(agent)) continue
          seen.add(link.linkPath)
          // Healthy iff the symlink still points where we recorded AND
          // the underlying bundle's SKILL.md is still on disk.
          const declared = await declaredTarget(link.linkPath)
          const symlinkMatches =
            declared !== null && declared === link.workspacePath
          const bundlePresent = await fileExists(
            join(link.workspacePath, 'SKILL.md'),
          )
          const healthy = symlinkMatches && bundlePresent
          out.push({
            skillName: dirName,
            name: entry.name,
            agent,
            linkPath: link.linkPath,
            workspacePath: link.workspacePath,
            broken: healthy ? undefined : true,
          })
        }
      }

      if (!listOpts.scanUnmanaged) return out

      const scanAgents = agentFilter
        ? (Array.from(agentFilter) as AgentId[])
        : (Object.keys(agentsCatalog) as AgentId[])
      for (const agent of scanAgents) {
        const agentDir = agentDirFor(agent)
        let entries: string[] = []
        try {
          entries = await readdir(agentDir)
        } catch {
          continue
        }
        for (const entryName of entries) {
          const linkPath = join(agentDir, entryName)
          if (seen.has(linkPath)) continue
          const declared = await declaredTarget(linkPath)
          if (declared === null || !declaresIntoWorkspace(declared)) continue
          if (skillFilter && !skillFilter.has(entryName)) continue
          out.push({
            skillName: entryName,
            name: entryName,
            agent,
            linkPath,
            workspacePath: declared,
            unmanaged: true,
          })
        }
      }
      return out
    },

    async rescan(rescanOpts = {}) {
      return await enqueueWrite(async () => {
        const prior =
          rescanOpts.mode === 'replace' ? emptyManifest() : await readManifest()
        const next = emptyManifest()
        const adopted: string[] = []
        const preserved: string[] = []
        const linksAdopted: RescanResult['linksAdopted'] = []

        let entries: string[] = []
        try {
          entries = await readdir(workspaceDir)
        } catch {
          /* empty */
        }
        for (const name of entries) {
          if (isReservedManifestEntry(name)) continue
          const workspacePath = join(workspaceDir, name)
          const meta = await readSkillMd(workspacePath)
          if (!meta) continue
          const priorEntry = prior.skills[name]
          if (priorEntry) {
            preserved.push(name)
            // `??` (not `||`) — if the user intentionally blanked the
            // frontmatter description, an empty string should win over the
            // cached prior value.
            next.skills[name] = {
              ...priorEntry,
              name: meta.name === '' ? priorEntry.name : meta.name,
              description: meta.description,
              links: {},
            }
          } else {
            adopted.push(name)
            next.skills[name] = {
              name: meta.name === '' ? name : meta.name,
              description: meta.description,
              source: { kind: 'local', path: workspacePath },
              addedAt: new Date().toISOString(),
              links: {},
            }
          }
        }

        const scanAgents = Object.keys(agentsCatalog) as AgentId[]
        for (const agent of scanAgents) {
          const agentDir = agentDirFor(agent)
          let agentEntries: string[] = []
          try {
            agentEntries = await readdir(agentDir)
          } catch {
            continue
          }
          for (const entryName of agentEntries) {
            const linkPath = join(agentDir, entryName)
            const declared = await declaredTarget(linkPath)
            if (declared === null || !declaresIntoWorkspace(declared)) continue
            const targetEntry = next.skills[entryName]
            if (!targetEntry) continue
            const priorLink = prior.skills[entryName]?.links[agent]
            targetEntry.links[agent] = {
              linkPath,
              workspacePath: declared,
              createdAt: priorLink?.createdAt ?? new Date().toISOString(),
            }
            linksAdopted.push({ skillName: entryName, agent, linkPath })
          }
        }

        const removed = Object.keys(prior.skills).filter((n) => !next.skills[n])
        await saveManifest(workspaceDir, next)
        return { adopted, preserved, removed, linksAdopted }
      })
    },
  }

  return manager
}
