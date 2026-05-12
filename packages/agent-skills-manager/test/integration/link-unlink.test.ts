import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { lstat, mkdir, readFile, readlink, writeFile } from 'node:fs/promises'
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

function makeManagerWithFakeAgentDir() {
  const claudeDir = join(tmp.home, '.claude/skills')
  const mgr = createSkillsManager({
    workspaceDir: tmp.workspaceDir,
    agentSkillsDirs: { 'claude-code': claudeDir },
  })
  return { mgr, claudeDir }
}

describe('link()', () => {
  test('creates a symlink and records it in the manifest', async () => {
    await writeSkillSource(join(tmp.workspaceDir, 'my-skill'), {
      name: 'my-skill',
      description: 'test',
    })
    const { mgr, claudeDir } = makeManagerWithFakeAgentDir()

    const res = await mgr.link({ skillName: 'my-skill', agent: 'claude-code' })

    expect(res.created).toBe(true)
    expect(res.linkPath).toBe(join(claudeDir, 'my-skill'))
    expect((await lstat(res.linkPath)).isSymbolicLink()).toBe(true)
    expect(await readlink(res.linkPath)).toBe(
      join(tmp.workspaceDir, 'my-skill'),
    )

    const manifest = JSON.parse(
      await readFile(join(tmp.workspaceDir, '.manifest.json'), 'utf8'),
    )
    expect(manifest.skills['my-skill'].links['claude-code']).toMatchObject({
      linkPath: res.linkPath,
      workspacePath: join(tmp.workspaceDir, 'my-skill'),
    })

    const again = await mgr.link({
      skillName: 'my-skill',
      agent: 'claude-code',
    })
    expect(again.created).toBe(false)
  })

  test('throws SkillNotFoundError when bundle is missing from workspace', async () => {
    const { mgr } = makeManagerWithFakeAgentDir()
    await expect(
      mgr.link({ skillName: 'ghost', agent: 'claude-code' }),
    ).rejects.toThrow(/not in workspace/)
  })

  test('throws ForeignPathError when a non-symlink occupies the target', async () => {
    await writeSkillSource(join(tmp.workspaceDir, 'my-skill'), {
      name: 'my-skill',
    })
    const { mgr, claudeDir } = makeManagerWithFakeAgentDir()
    // User has their own real folder where our link would go.
    await mkdir(join(claudeDir, 'my-skill'), { recursive: true })
    await writeFile(join(claudeDir, 'my-skill/README.md'), 'mine')

    await expect(
      mgr.link({ skillName: 'my-skill', agent: 'claude-code' }),
    ).rejects.toThrow(/Refusing to overwrite/)
  })
})

describe('unlink()', () => {
  test('removes the symlink and manifest entry', async () => {
    await writeSkillSource(join(tmp.workspaceDir, 'my-skill'), {
      name: 'my-skill',
    })
    const { mgr, claudeDir } = makeManagerWithFakeAgentDir()
    await mgr.link({ skillName: 'my-skill', agent: 'claude-code' })

    const res = await mgr.unlink({
      skillName: 'my-skill',
      agent: 'claude-code',
    })
    expect(res.removed).toBe(true)
    expect(res.linkPath).toBe(join(claudeDir, 'my-skill'))

    let exists = true
    try {
      await lstat(res.linkPath)
    } catch {
      exists = false
    }
    expect(exists).toBe(false)

    const manifest = JSON.parse(
      await readFile(join(tmp.workspaceDir, '.manifest.json'), 'utf8'),
    )
    expect(manifest.skills['my-skill'].links).toEqual({})
  })

  test('refuses to remove a hand-rolled symlink the manifest does not record', async () => {
    await writeSkillSource(join(tmp.workspaceDir, 'my-skill'), {
      name: 'my-skill',
    })
    const { mgr, claudeDir } = makeManagerWithFakeAgentDir()
    await mkdir(claudeDir, { recursive: true })
    const { symlink } = await import('node:fs/promises')
    await symlink(
      join(tmp.workspaceDir, 'my-skill'),
      join(claudeDir, 'my-skill'),
      'dir',
    )

    const res = await mgr.unlink({
      skillName: 'my-skill',
      agent: 'claude-code',
    })
    expect(res.removed).toBe(false)
    expect(res.unmanaged).toBe(true)
    // Hand-rolled link is untouched.
    expect((await lstat(join(claudeDir, 'my-skill'))).isSymbolicLink()).toBe(
      true,
    )
  })

  test('returns foreign:true when path is a real folder', async () => {
    const { mgr, claudeDir } = makeManagerWithFakeAgentDir()
    await mkdir(join(claudeDir, 'whatever'), { recursive: true })
    const res = await mgr.unlink({
      skillName: 'whatever',
      agent: 'claude-code',
    })
    expect(res.removed).toBe(false)
    expect(res.foreign).toBe(true)
  })
})
