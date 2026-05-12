import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TmpWorkspace {
  /** Root tmp dir. */
  root: string
  /** `${root}/workspace` — pass as workspaceDir. */
  workspaceDir: string
  /**
   * `${root}/home` — pass into `agentSkillsDirs` overrides when a test
   * needs to redirect an agent's skills dir. Never modifies real $HOME.
   */
  home: string
  cleanup(): Promise<void>
}

export async function makeTmpWorkspace(): Promise<TmpWorkspace> {
  const root = await mkdtemp(join(tmpdir(), 'skills-mgr-'))
  const workspaceDir = join(root, 'workspace')
  const home = join(root, 'home')
  await mkdir(workspaceDir, { recursive: true })
  await mkdir(home, { recursive: true })
  return {
    root,
    workspaceDir,
    home,
    async cleanup() {
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
