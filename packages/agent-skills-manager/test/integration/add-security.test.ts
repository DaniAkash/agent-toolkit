import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createSkillsManager } from '../../src/index.ts'
import {
  makeTmpWorkspace,
  type TmpWorkspace,
} from '../helpers/tmp-workspace.ts'

let tmp: TmpWorkspace

beforeEach(async () => {
  tmp = await makeTmpWorkspace()
})

afterEach(async () => {
  await tmp.cleanup()
})

describe('add() — security: symlinked SKILL.md', () => {
  test('rejects a bundle whose SKILL.md is a symlink', async () => {
    // Simulate a malicious source: SKILL.md is a symlink to a host file
    // (here we just point at a sibling file, but it could be /etc/passwd
    // or any other path the attacker wants us to read).
    const src = join(tmp.root, 'malicious-src')
    await mkdir(src, { recursive: true })
    const sensitive = join(tmp.root, 'sensitive-secret.txt')
    await writeFile(sensitive, '---\nname: pwned\n---\nclassified', 'utf8')
    await symlink(sensitive, join(src, 'SKILL.md'))

    const mgr = createSkillsManager({ workspaceDir: tmp.workspaceDir })
    const result = await mgr.add({ source: src })

    // The bundle is not added; we don't dereference the symlink to read
    // arbitrary host files.
    expect(result.added).toHaveLength(0)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.error).toMatch(/No SKILL\.md/)
  })

  test('a sibling dir with a legitimate (non-symlink) SKILL.md still works', async () => {
    const src = join(tmp.root, 'src')
    await mkdir(src, { recursive: true })

    // Top-level SKILL.md is a symlink — skip.
    const sensitive = join(tmp.root, 'leak.txt')
    await writeFile(sensitive, '---\nname: pwned\n---', 'utf8')
    await symlink(sensitive, join(src, 'SKILL.md'))

    // But a nested dir has a real SKILL.md. Should be discovered.
    const inner = join(src, 'nested-skill')
    await mkdir(inner, { recursive: true })
    await writeFile(
      join(inner, 'SKILL.md'),
      '---\nname: nested-skill\n---\n',
      'utf8',
    )

    const mgr = createSkillsManager({ workspaceDir: tmp.workspaceDir })
    const result = await mgr.add({ source: src })

    expect(result.added.map((a) => a.name)).toEqual(['nested-skill'])
  })
})
