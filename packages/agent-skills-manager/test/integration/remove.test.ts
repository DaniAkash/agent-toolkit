import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { lstat, readFile } from 'node:fs/promises'
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

describe('remove()', () => {
  test('deletes workspace bundle + manifest entry, leaves agent links dangling', async () => {
    const claudeDir = join(tmp.home, '.claude/skills')
    const mgr = createSkillsManager({
      workspaceDir: tmp.workspaceDir,
      agentSkillsDirs: { 'claude-code': claudeDir },
    })
    const src = join(tmp.root, 'src')
    await writeSkillSource(src, { name: 'doomed' })
    await mgr.add({ source: src })
    await mgr.link({ skillName: 'doomed', agent: 'claude-code' })

    await mgr.remove({ skillName: 'doomed' })

    let bundleStillThere = true
    try {
      await lstat(join(tmp.workspaceDir, 'doomed'))
    } catch {
      bundleStillThere = false
    }
    expect(bundleStillThere).toBe(false)

    const manifest = JSON.parse(
      await readFile(join(tmp.workspaceDir, '.manifest.json'), 'utf8'),
    )
    expect(manifest.skills.doomed).toBeUndefined()

    // The dangling symlink is still on disk — listLinks would report broken: true,
    // but remove() doesn't walk agent dirs.
    expect((await lstat(join(claudeDir, 'doomed'))).isSymbolicLink()).toBe(true)
  })
})

describe('removeWithLinks()', () => {
  test('removes manifest links + symlinks + workspace bundle', async () => {
    const claudeDir = join(tmp.home, '.claude/skills')
    const codexDir = join(tmp.home, '.codex/skills')
    const mgr = createSkillsManager({
      workspaceDir: tmp.workspaceDir,
      agentSkillsDirs: { 'claude-code': claudeDir, codex: codexDir },
    })
    const src = join(tmp.root, 'src')
    await writeSkillSource(src, { name: 'gone' })
    await mgr.add({ source: src })
    await mgr.link({ skillName: 'gone', agent: 'claude-code' })
    await mgr.link({ skillName: 'gone', agent: 'codex' })

    const res = await mgr.removeWithLinks({ skillName: 'gone' })

    expect(res.unlinked.map((l) => l.agent).sort()).toEqual([
      'claude-code',
      'codex',
    ])

    for (const path of [
      join(tmp.workspaceDir, 'gone'),
      join(claudeDir, 'gone'),
      join(codexDir, 'gone'),
    ]) {
      let stillThere = true
      try {
        await lstat(path)
      } catch {
        stillThere = false
      }
      expect(stillThere).toBe(false)
    }

    const manifest = JSON.parse(
      await readFile(join(tmp.workspaceDir, '.manifest.json'), 'utf8'),
    )
    expect(manifest.skills.gone).toBeUndefined()
  })
})
