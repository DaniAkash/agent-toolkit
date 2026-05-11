import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TmpWorkspace {
  /** Root tmp dir. */
  root: string
  /** `${root}/workspace` — pass as workspaceDir. */
  workspaceDir: string
  /** `${root}/home` — what we pin $HOME to for agent-dir resolution. */
  home: string
  cleanup(): Promise<void>
}

const HOME_KEYS = ['HOME', 'USERPROFILE'] as const

export async function makeTmpWorkspace(): Promise<TmpWorkspace> {
  const root = await mkdtemp(join(tmpdir(), 'skills-mgr-'))
  const workspaceDir = join(root, 'workspace')
  const home = join(root, 'home')
  await mkdir(workspaceDir, { recursive: true })
  await mkdir(home, { recursive: true })
  const prior = new Map<string, string | undefined>()
  for (const key of HOME_KEYS) {
    prior.set(key, process.env[key])
    process.env[key] = home
  }
  return {
    root,
    workspaceDir,
    home,
    async cleanup() {
      for (const [key, val] of prior) {
        if (val === undefined) delete process.env[key]
        else process.env[key] = val
      }
      await rm(root, { recursive: true, force: true })
    },
  }
}

export async function writeSkillSource(
  dir: string,
  frontmatter: { name: string; description?: string },
  body = '',
): Promise<void> {
  await mkdir(dir, { recursive: true })
  const fm = [
    '---',
    `name: ${frontmatter.name}`,
    ...(frontmatter.description
      ? [`description: ${frontmatter.description}`]
      : []),
    '---',
    '',
    body,
  ].join('\n')
  await writeFile(join(dir, 'SKILL.md'), fm, 'utf8')
}
