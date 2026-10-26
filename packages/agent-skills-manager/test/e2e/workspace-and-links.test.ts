/**
 * End-to-end scenario in a throwaway directory.
 *
 * NOT run by default: it writes files, creates symlinks, and one test
 * fetches a real repository over the network. Every agent skills
 * directory is redirected into the temp tree, so the real HOME is never
 * touched.
 *
 *   SKILLS_E2E=1 bun test test/e2e
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSkillsManager,
  listSupportedAgents,
  resolveAgentSkillsDir,
} from '../../src/index.ts'

const ENABLED = Boolean(process.env.SKILLS_E2E)

let root: string
let workspace: string
let home: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skills-e2e-'))
  workspace = join(root, 'skills-workspace')
  home = join(root, 'home')
  await mkdir(workspace, { recursive: true })
  await mkdir(home, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Write a SKILL.md with the given raw frontmatter body. */
async function writeSkill(dir: string, frontmatter: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'SKILL.md'),
    `${frontmatter}\n\nSome body text.\n`,
    'utf8',
  )
  return dir
}

describe.skipIf(!ENABLED)('refreshed catalog', () => {
  test('reports the 1.7.4 roster and the moved Codex directory', () => {
    expect(listSupportedAgents()).toHaveLength(79)
    // Upstream PR 2067 moved this from ~/.codex/skills.
    expect(resolveAgentSkillsDir('codex')).toEndWith(join('.agents', 'skills'))
    for (const id of ['fx', 'posit-assistant', 'sarvam-code']) {
      expect(listSupportedAgents().some((a) => a.id === id)).toBe(true)
    }
  })
})

describe.skipIf(!ENABLED)('adding a real skill from disk', () => {
  test('a BOM-prefixed hostile SKILL.md parses and is sanitised', async () => {
    const src = await writeSkill(
      join(root, 'src-skill'),
      '﻿---\nname: e2e-skill\ndescription: \u001b[2Jreal description\n---',
    )
    const mgr = createSkillsManager({ workspaceDir: workspace })
    const added = await mgr.add({ source: src })

    expect(added.failed).toEqual([])
    expect(added.added).toHaveLength(1)
    expect(added.added[0]?.name).toBe('e2e-skill')
    // BOM tolerated, escape stripped.
    expect(added.added[0]?.description).toBe('real description')
  })
})

describe.skipIf(!ENABLED)('agents sharing one skills root', () => {
  test('a shared symlink serves both, and the survivor reports broken', async () => {
    const shared = join(home, '.agents', 'skills')
    const claudeDir = join(home, '.claude', 'skills')
    await mkdir(shared, { recursive: true })
    await mkdir(claudeDir, { recursive: true })

    const src = await writeSkill(
      join(root, 'src-skill'),
      '---\nname: e2e-skill\ndescription: d\n---',
    )
    const mgr = createSkillsManager({
      workspaceDir: workspace,
      agentSkillsDirs: {
        codex: shared,
        fx: shared,
        'claude-code': claudeDir,
      },
    })
    await mgr.add({ source: src })

    const a = await mgr.link({ skillName: 'e2e-skill', agent: 'codex' })
    const b = await mgr.link({ skillName: 'e2e-skill', agent: 'fx' })
    expect(a.linkPath).toBe(b.linkPath)

    // The link resolves into the workspace and the bundle reads through it.
    expect(await readlink(a.linkPath)).toStartWith(workspace)
    expect(await readFile(join(a.linkPath, 'SKILL.md'), 'utf8')).toContain(
      'Some body text.',
    )

    const c = await mgr.link({ skillName: 'e2e-skill', agent: 'claude-code' })
    expect(c.linkPath).not.toBe(a.linkPath)

    await mgr.unlink({ skillName: 'e2e-skill', agent: 'codex' })

    const links = await mgr.listLinks()
    // fx's entry described the symlink codex just removed, so it is stale.
    // Reported as broken rather than silently claimed healthy.
    expect(links.find((l) => l.agent === 'fx')?.broken).toBe(true)
    expect(links.find((l) => l.agent === 'claude-code')?.broken).toBeUndefined()
  })
})

describe.skipIf(!ENABLED)('a directory that moved upstream', () => {
  test('unlink follows the recorded path, not the recomputed one', async () => {
    const legacy = join(home, '.codex', 'skills')
    const current = join(home, '.agents', 'skills')
    await mkdir(legacy, { recursive: true })
    await mkdir(current, { recursive: true })

    const src = await writeSkill(
      join(root, 'src-skill'),
      '---\nname: e2e-skill\ndescription: d\n---',
    )

    // Link while the catalog still points at the legacy location.
    const before = createSkillsManager({
      workspaceDir: workspace,
      agentSkillsDirs: { codex: legacy },
    })
    await before.add({ source: src })
    const linked = await before.link({
      skillName: 'e2e-skill',
      agent: 'codex',
    })
    expect(linked.linkPath).toBe(join(legacy, 'e2e-skill'))

    // The catalog now resolves elsewhere, as it does after the refresh.
    const after = createSkillsManager({
      workspaceDir: workspace,
      agentSkillsDirs: { codex: current },
    })
    const unlinked = await after.unlink({
      skillName: 'e2e-skill',
      agent: 'codex',
    })
    expect(unlinked.removed).toBe(true)
    expect(unlinked.linkPath).toBe(join(legacy, 'e2e-skill'))
    expect(await after.listLinks()).toEqual([])
  })
})

describe.skipIf(!ENABLED)('a real remote source', () => {
  test('a GitHub repository is fetched, parsed and sanitised', async () => {
    const mgr = createSkillsManager({ workspaceDir: workspace })
    const result = await mgr.add({
      source: 'vercel-labs/skills',
      skillNames: '*',
    })

    expect(result.failed).toEqual([])
    expect(result.added.length + result.skipped.length).toBeGreaterThan(0)
    for (const skill of result.added) {
      // Metadata from an arbitrary repository must arrive escape-free.
      expect(skill.description).not.toContain('\u001b')
      expect(skill.name).not.toContain('\u001b')
    }
  })
})
