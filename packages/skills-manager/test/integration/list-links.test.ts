import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createSkillsManager } from '../../src/index.ts'
import {
  makeTmpWorkspace,
  type TmpWorkspace,
  writeSkillSource,
} from '../helpers/tmp-workspace.ts'

let tmp: TmpWorkspace

beforeEach(async () => {
  tmp = await makeTmpWorkspace()
})

afterEach(async () => {
  await tmp.cleanup()
})

function mgrWithDirs() {
  const claudeDir = join(tmp.home, '.claude/skills')
  const codexDir = join(tmp.home, '.codex/skills')
  const mgr = createSkillsManager({
    workspaceDir: tmp.workspaceDir,
    agentSkillsDirs: { 'claude-code': claudeDir, codex: codexDir },
  })
  return { mgr, claudeDir, codexDir }
}

describe('listLinks()', () => {
  test('returns manifest-recorded links verified against disk', async () => {
    await writeSkillSource(join(tmp.workspaceDir, 'a'), { name: 'a' })
    const { mgr, claudeDir, codexDir } = mgrWithDirs()
    await mgr.link({ skillName: 'a', agent: 'claude-code' })
    await mgr.link({ skillName: 'a', agent: 'codex' })

    const links = await mgr.listLinks()
    expect(links).toHaveLength(2)
    expect(links.find((l) => l.agent === 'claude-code')?.linkPath).toBe(
      join(claudeDir, 'a'),
    )
    expect(links.find((l) => l.agent === 'codex')?.linkPath).toBe(
      join(codexDir, 'a'),
    )
    for (const l of links) {
      expect(l.broken).toBeUndefined()
      expect(l.unmanaged).toBeUndefined()
    }
  })

  test('reports broken:true when symlink is gone but manifest still records it', async () => {
    await writeSkillSource(join(tmp.workspaceDir, 'a'), { name: 'a' })
    const { mgr, claudeDir } = mgrWithDirs()
    await mgr.link({ skillName: 'a', agent: 'claude-code' })

    await rm(join(claudeDir, 'a'), { force: true })

    const links = await mgr.listLinks()
    expect(links).toHaveLength(1)
    expect(links[0]?.broken).toBe(true)
  })

  test('opt-in scanUnmanaged surfaces hand-rolled symlinks-into-workspace', async () => {
    await writeSkillSource(join(tmp.workspaceDir, 'a'), { name: 'a' })
    const { mgr, claudeDir } = mgrWithDirs()
    await mkdir(claudeDir, { recursive: true })
    await symlink(join(tmp.workspaceDir, 'a'), join(claudeDir, 'a'), 'dir')

    const defaultLinks = await mgr.listLinks({ agents: ['claude-code'] })
    expect(defaultLinks).toHaveLength(0)

    const scanned = await mgr.listLinks({
      agents: ['claude-code'],
      scanUnmanaged: true,
    })
    expect(scanned).toHaveLength(1)
    expect(scanned[0]?.unmanaged).toBe(true)
    expect(scanned[0]?.workspacePath).toBe(join(tmp.workspaceDir, 'a'))
  })

  test('foreign symlinks pointing outside workspace never appear', async () => {
    await writeSkillSource(join(tmp.workspaceDir, 'a'), { name: 'a' })
    const { mgr, claudeDir } = mgrWithDirs()
    await mkdir(claudeDir, { recursive: true })
    // Symlink that points OUTSIDE our workspace — must be invisible.
    const outside = join(tmp.root, 'outside-skill')
    await mkdir(outside, { recursive: true })
    await symlink(outside, join(claudeDir, 'outsider'), 'dir')

    const scanned = await mgr.listLinks({
      agents: ['claude-code'],
      scanUnmanaged: true,
    })
    expect(scanned.map((l) => l.skillName)).not.toContain('outsider')
  })
})
