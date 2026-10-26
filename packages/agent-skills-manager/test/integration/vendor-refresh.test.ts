/**
 * Guards for the behaviours that changed when the vendored
 * `vercel-labs/skills` subset moved from 1.5.22 to 1.7.4.
 *
 * Each test here corresponds to something that was silently wrong before
 * the refresh, so each should fail if the relevant fix is reverted.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createSkillsManager } from '../../src/index.ts'
import {
  makeTmpWorkspace,
  type TmpWorkspace,
  writeSkillSource,
} from '../helpers/tmp-workspace.ts'

let ws: TmpWorkspace

beforeEach(async () => {
  ws = await makeTmpWorkspace()
})
afterEach(async () => {
  await ws.cleanup()
})

describe('BOM-prefixed SKILL.md frontmatter', () => {
  test('name and description parse through a UTF-8 BOM', async () => {
    // Upstream PR 2421. Editors on Windows emit a BOM; the old regex did
    // not tolerate it, so parseFrontmatter returned {} and the failure was
    // silent: the name fell back to the directory and the description went
    // empty, with add() still reporting success.
    const src = join(ws.root, 'bom-src')
    await mkdir(src, { recursive: true })
    await writeFile(
      join(src, 'SKILL.md'),
      `﻿---\nname: bom-skill\ndescription: survives a byte order mark\n---\n\nbody\n`,
      'utf8',
    )

    const mgr = createSkillsManager({ workspaceDir: ws.workspaceDir })
    const result = await mgr.add({ source: src })

    expect(result.failed).toEqual([])
    expect(result.added).toHaveLength(1)
    expect(result.added[0]?.description).toBe('survives a byte order mark')

    const listed = await mgr.listSkills()
    expect(listed[0]?.name).toBe('bom-skill')
    expect(listed[0]?.description).toBe('survives a byte order mark')
  })
})

describe('agent skills directory moves', () => {
  test('unlink removes a link recorded at a since-moved directory', async () => {
    // Codex's global skills dir moved from ~/.codex/skills to
    // ~/.agents/skills upstream (PR 2067). A link created before the move
    // is recorded in the manifest at the old path. Recomputing the path
    // from the refreshed catalog would miss it and orphan both the symlink
    // and its manifest entry.
    const legacyDir = join(ws.home, '.codex', 'skills')
    const currentDir = join(ws.home, '.agents', 'skills')
    await mkdir(legacyDir, { recursive: true })
    await mkdir(currentDir, { recursive: true })

    const src = join(ws.root, 'src')
    await writeSkillSource(src, { name: 'movable', description: 'd' })

    // Link while the catalog still points at the legacy location.
    const legacyMgr = createSkillsManager({
      workspaceDir: ws.workspaceDir,
      agentSkillsDirs: { codex: legacyDir },
    })
    await legacyMgr.add({ source: src })
    const linked = await legacyMgr.link({
      skillName: 'movable',
      agent: 'codex',
    })
    expect(linked.linkPath).toBe(join(legacyDir, 'movable'))

    // Now the catalog resolves somewhere else, as it does after the refresh.
    const movedMgr = createSkillsManager({
      workspaceDir: ws.workspaceDir,
      agentSkillsDirs: { codex: currentDir },
    })
    const unlinked = await movedMgr.unlink({
      skillName: 'movable',
      agent: 'codex',
    })

    expect(unlinked.removed).toBe(true)
    expect(unlinked.linkPath).toBe(join(legacyDir, 'movable'))

    const remaining = await movedMgr.listLinks()
    expect(remaining).toEqual([])
  })

  test('an explicit agentSkillsDir still wins over the recorded path', async () => {
    // The recorded-path preference must not override a caller who names
    // the directory, or an override could never target a fresh location.
    const dirA = join(ws.home, 'a', 'skills')
    const dirB = join(ws.home, 'b', 'skills')
    await mkdir(dirA, { recursive: true })
    await mkdir(dirB, { recursive: true })

    const src = join(ws.root, 'src')
    await writeSkillSource(src, { name: 'pinned', description: 'd' })

    const mgr = createSkillsManager({
      workspaceDir: ws.workspaceDir,
      agentSkillsDirs: { codex: dirA },
    })
    await mgr.add({ source: src })
    await mgr.link({ skillName: 'pinned', agent: 'codex' })

    const unlinked = await mgr.unlink({
      skillName: 'pinned',
      agent: 'codex',
      agentSkillsDir: dirB,
    })
    expect(unlinked.linkPath).toBe(join(dirB, 'pinned'))
    expect(unlinked.removed).toBe(false)
  })
})

describe('agents sharing one skills root', () => {
  test('unlinking one agent leaves another agent link in the same root intact', async () => {
    // The 1.7.4 catalog points codex, fx, pi and sarvam-code all at
    // ~/.agents/skills, so two agents can resolve to the same directory.
    // Both manifest entries then describe the same symlink.
    const shared = join(ws.home, '.agents', 'skills')
    await mkdir(shared, { recursive: true })

    const src = join(ws.root, 'src')
    await writeSkillSource(src, { name: 'shared', description: 'd' })

    const mgr = createSkillsManager({
      workspaceDir: ws.workspaceDir,
      agentSkillsDirs: { codex: shared, fx: shared },
    })
    await mgr.add({ source: src })
    const a = await mgr.link({ skillName: 'shared', agent: 'codex' })
    const b = await mgr.link({ skillName: 'shared', agent: 'fx' })
    expect(a.linkPath).toBe(b.linkPath)

    await mgr.unlink({ skillName: 'shared', agent: 'codex' })

    // The symlink is gone, so fx's manifest entry is now stale. It must be
    // reported as broken rather than silently claimed healthy: this is the
    // documented consequence of a shared root, not a crash.
    const links = await mgr.listLinks()
    const fxLink = links.find((l) => l.agent === 'fx')
    expect(fxLink).toBeDefined()
    expect(fxLink?.broken).toBe(true)
  })
})
