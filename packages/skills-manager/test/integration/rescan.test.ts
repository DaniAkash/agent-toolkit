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

describe('rescan()', () => {
  test('merge mode preserves existing source + addedAt for rediscovered entries', async () => {
    const mgr = createSkillsManager({ workspaceDir: tmp.workspaceDir })
    const src = join(tmp.root, 'src')
    await writeSkillSource(src, { name: 'kept', description: 'd' })
    await mgr.add({ source: src })

    const beforeListed = await mgr.listSkills()
    const originalAddedAt = beforeListed[0]?.addedAt

    // Rescan should preserve metadata for the still-present bundle.
    const result = await mgr.rescan({ mode: 'merge' })
    expect(result.adopted).toEqual([])
    expect(result.preserved).toEqual(['kept'])
    expect(result.removed).toEqual([])

    const afterListed = await mgr.listSkills()
    expect(afterListed[0]?.addedAt).toBe(originalAddedAt)
    expect(afterListed[0]?.source).toEqual({ kind: 'local', path: src })
  })

  test('merge mode adopts a hand-dropped workspace bundle', async () => {
    const mgr = createSkillsManager({ workspaceDir: tmp.workspaceDir })
    await writeSkillSource(join(tmp.workspaceDir, 'rogue'), {
      name: 'rogue',
      description: 'hand-dropped',
    })

    const result = await mgr.rescan({ mode: 'merge' })
    expect(result.adopted).toEqual(['rogue'])

    const listed = await mgr.listSkills()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.unmanaged).toBeUndefined()
    expect(listed[0]?.source).toEqual({
      kind: 'local',
      path: join(tmp.workspaceDir, 'rogue'),
    })
  })

  test('merge mode adopts a hand-rolled agent symlink-into-workspace', async () => {
    const claudeDir = join(tmp.home, '.claude/skills')
    const mgr = createSkillsManager({
      workspaceDir: tmp.workspaceDir,
      agentSkillsDirs: { 'claude-code': claudeDir },
    })
    await writeSkillSource(join(tmp.workspaceDir, 'mine'), { name: 'mine' })
    await mkdir(claudeDir, { recursive: true })
    await symlink(
      join(tmp.workspaceDir, 'mine'),
      join(claudeDir, 'mine'),
      'dir',
    )

    const result = await mgr.rescan({ mode: 'merge' })
    expect(result.adopted).toEqual(['mine'])
    expect(result.linksAdopted.map((l) => l.agent)).toContain('claude-code')

    // Now unlink succeeds (manifest knows about the link).
    const unlinkRes = await mgr.unlink({
      skillName: 'mine',
      agent: 'claude-code',
    })
    expect(unlinkRes.removed).toBe(true)
  })

  test('merge mode drops manifest entries whose bundle is gone', async () => {
    const mgr = createSkillsManager({ workspaceDir: tmp.workspaceDir })
    const src = join(tmp.root, 'src')
    await writeSkillSource(src, { name: 'gone' })
    await mgr.add({ source: src })

    await rm(join(tmp.workspaceDir, 'gone'), { recursive: true, force: true })

    const result = await mgr.rescan({ mode: 'merge' })
    expect(result.removed).toEqual(['gone'])
    expect(await mgr.listSkills()).toEqual([])
  })

  test('replace mode discards prior metadata', async () => {
    const mgr = createSkillsManager({ workspaceDir: tmp.workspaceDir })
    const src = join(tmp.root, 'src')
    await writeSkillSource(src, { name: 'one' })
    await mgr.add({ source: src })

    const [before] = await mgr.listSkills()
    expect(before?.source).toEqual({ kind: 'local', path: src })

    const result = await mgr.rescan({ mode: 'replace' })
    expect(result.adopted).toEqual(['one'])
    expect(result.preserved).toEqual([])

    const [after] = await mgr.listSkills()
    // After replace, source is reseeded to point at the workspace bundle dir.
    expect(after?.source).toEqual({
      kind: 'local',
      path: join(tmp.workspaceDir, 'one'),
    })
  })
})
