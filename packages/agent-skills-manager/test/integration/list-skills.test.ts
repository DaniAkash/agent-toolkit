import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
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

describe('listSkills()', () => {
  test('returns manifest entries with source + addedAt', async () => {
    const srcA = join(tmp.root, 'src-a')
    const srcB = join(tmp.root, 'src-b')
    await writeSkillSource(srcA, { name: 'alpha', description: 'a' })
    await writeSkillSource(srcB, { name: 'beta', description: 'b' })

    const mgr = createSkillsManager({ workspaceDir: tmp.workspaceDir })
    await mgr.add({ source: srcA })
    await mgr.add({ source: srcB })

    const skills = await mgr.listSkills()
    const names = skills.map((s) => s.name).sort()
    expect(names).toEqual(['alpha', 'beta'])
    for (const s of skills) {
      expect(s.source).toBeDefined()
      expect(s.addedAt).toBeDefined()
      expect(s.broken).toBeUndefined()
      expect(s.unmanaged).toBeUndefined()
    }
  })

  test('reports broken:true when SKILL.md disappears from disk', async () => {
    const src = join(tmp.root, 'src')
    await writeSkillSource(src, { name: 'gonna-vanish' })

    const mgr = createSkillsManager({ workspaceDir: tmp.workspaceDir })
    await mgr.add({ source: src })

    await rm(join(tmp.workspaceDir, 'gonna-vanish'), {
      recursive: true,
      force: true,
    })

    const skills = await mgr.listSkills()
    expect(skills).toHaveLength(1)
    expect(skills[0]?.broken).toBe(true)
    // Source URL + addedAt preserved.
    expect(skills[0]?.source).toBeDefined()
    expect(skills[0]?.addedAt).toBeDefined()
  })

  test('opt-in scanUnmanaged surfaces dirs not in the manifest', async () => {
    const stray = join(tmp.workspaceDir, 'stray-skill')
    await writeSkillSource(stray, { name: 'stray', description: 'snuck in' })

    const mgr = createSkillsManager({ workspaceDir: tmp.workspaceDir })

    const skillsDefault = await mgr.listSkills()
    expect(skillsDefault).toHaveLength(0)

    const skillsScanned = await mgr.listSkills({ scanUnmanaged: true })
    expect(skillsScanned).toHaveLength(1)
    expect(skillsScanned[0]?.unmanaged).toBe(true)
    expect(skillsScanned[0]?.name).toBe('stray')
    expect(skillsScanned[0]?.source).toBeUndefined()
  })

  test('ignores .manifest.json and tmp files when scanning unmanaged', async () => {
    const mgr = createSkillsManager({ workspaceDir: tmp.workspaceDir })
    await mgr.add({
      source: await (async () => {
        const src = join(tmp.root, 'one')
        await writeSkillSource(src, { name: 'one' })
        return src
      })(),
    })
    // Manifest file is now next to one/. Scan should not return ".manifest.json" as a skill.
    const skills = await mgr.listSkills({ scanUnmanaged: true })
    expect(skills.map((s) => s.name)).toEqual(['one'])
  })
})
