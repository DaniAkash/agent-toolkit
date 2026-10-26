/**
 * End-to-end scenario against real config files in a throwaway directory.
 *
 * NOT run by default: it writes files and is slower than the unit suite.
 * The real HOME is never touched; every path lives inside a mkdtemp root.
 *
 *   MCP_E2E=1 bun test test/e2e
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BoundApi, bind } from '../../src/index.ts'

const ENABLED = Boolean(process.env.MCP_E2E)

// A real hand-written Codex config: comments, a blank line, a table.
const CODEX_TOML = `# My everyday model, do not change
model = "o3"
approval_policy = "on-request"

# Sandbox is deliberately tight here
[sandbox_workspace_write]
network_access = false
`

let root: string
let workspace: string
let home: string
let api: BoundApi

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcp-e2e-'))
  workspace = join(root, 'workspace')
  home = join(root, 'home')
  await mkdir(workspace, { recursive: true })
  await mkdir(home, { recursive: true })
  api = bind(workspace)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe.skipIf(!ENABLED)('Codex config.toml, hand-edited', () => {
  test('a server round-trips without disturbing the user content', async () => {
    const codexPath = join(home, '.codex', 'config.toml')
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(codexPath, CODEX_TOML, 'utf8')

    await api.link({
      server: {
        name: 'context7',
        spec: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp'],
        },
      },
      agent: 'codex',
      configPath: codexPath,
    })

    const added = await readFile(codexPath, 'utf8')
    // Nothing before the insertion point moved by a byte.
    expect(added.startsWith(CODEX_TOML)).toBe(true)
    expect(added).toContain('# My everyday model, do not change')
    expect(added).toContain('# Sandbox is deliberately tight here')
    expect(added).toContain('[mcp_servers.context7]')
    expect(added).toContain('command = "npx"')
    expect(added).toContain('args = ["-y", "@upstash/context7-mcp"]')

    await api.unlink({
      serverName: 'context7',
      agent: 'codex',
      configPath: codexPath,
    })
    expect(await readFile(codexPath, 'utf8')).toBe(CODEX_TOML)
  })
})

describe.skipIf(!ENABLED)('Claude Code, three scopes in two files', () => {
  test('local and system entries coexist in one ~/.claude.json', async () => {
    const claudePath = join(home, '.claude.json')
    const projectRoot = join(root, 'myproject')
    await mkdir(projectRoot, { recursive: true })
    // Shaped like a real ~/.claude.json: unrelated top-level keys and a
    // project entry that already carries other settings.
    await writeFile(
      claudePath,
      `${JSON.stringify(
        {
          numStartups: 7,
          projects: { [projectRoot]: { allowedTools: ['Bash'] } },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    await api.link({
      server: {
        name: 'global-srv',
        spec: { transport: 'http', url: 'http://127.0.0.1:9001/mcp' },
      },
      agent: 'claude-code',
      scope: 'system',
      configPath: claudePath,
    })
    await api.link({
      server: {
        name: 'local-srv',
        spec: { transport: 'http', url: 'http://127.0.0.1:9002/mcp' },
      },
      agent: 'claude-code',
      scope: 'local',
      projectRoot,
      configPath: claudePath,
    })

    const doc = JSON.parse(await readFile(claudePath, 'utf8')) as {
      numStartups?: number
      mcpServers?: Record<string, unknown>
      projects?: Record<
        string,
        { allowedTools?: string[]; mcpServers?: Record<string, unknown> }
      >
    }

    expect(doc.mcpServers?.['global-srv']).toBeDefined()
    expect(doc.projects?.[projectRoot]?.mcpServers?.['local-srv']).toBeDefined()
    // Neither scope leaked into the other's container.
    expect(doc.mcpServers?.['local-srv']).toBeUndefined()
    expect(
      doc.projects?.[projectRoot]?.mcpServers?.['global-srv'],
    ).toBeUndefined()
    // And the keys that were already there survived.
    expect(doc.numStartups).toBe(7)
    expect(doc.projects?.[projectRoot]?.allowedTools).toEqual(['Bash'])
  })
})

describe.skipIf(!ENABLED)('OpenCode, released 1.x with a BOM', () => {
  test('a BOM-prefixed commented config is edited in place', async () => {
    const dir = join(home, '.config', 'opencode')
    await mkdir(dir, { recursive: true })
    const ocPath = join(dir, 'opencode.json')
    const original = `﻿{
  // my servers
  "mcp": {
    "existing": { "type": "remote", "url": "http://x/mcp", "enabled": true }
  }
}
`
    await writeFile(ocPath, original, 'utf8')

    await api.link({
      server: {
        name: 'added',
        spec: { transport: 'stdio', command: 'bunx', args: ['srv'] },
      },
      agent: 'opencode',
      configPath: ocPath,
    })

    const after = await readFile(ocPath, 'utf8')
    expect(after.startsWith('﻿')).toBe(true)
    expect(after).toContain('// my servers')

    const parsed = JSON.parse(
      after.replace(/^﻿/, '').replace(/^\s*\/\/.*$/gm, ''),
    ) as { mcp?: Record<string, Record<string, unknown>> }
    // Released 1.x keeps servers directly under `mcp`, not `mcp.servers`.
    expect(parsed.mcp?.servers).toBeUndefined()
    expect(parsed.mcp?.added?.command).toEqual(['bunx', 'srv'])
    expect(parsed.mcp?.existing).toBeDefined()
  })
})

describe.skipIf(!ENABLED)('manifest tracking', () => {
  test('listLinks reports every live link across agents and scopes', async () => {
    const claudePath = join(home, '.claude.json')
    await writeFile(claudePath, '{}\n', 'utf8')
    const codexPath = join(home, '.codex', 'config.toml')
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(codexPath, '', 'utf8')

    await api.link({
      server: {
        name: 'one',
        spec: { transport: 'http', url: 'http://127.0.0.1:1/mcp' },
      },
      agent: 'claude-code',
      configPath: claudePath,
    })
    await api.link({
      server: { name: 'two', spec: { transport: 'stdio', command: 'x' } },
      agent: 'codex',
      configPath: codexPath,
    })

    const links = await api.listLinks()
    expect(links).toHaveLength(2)
    expect(links.map((l) => `${l.agent}/${l.serverName}`).sort()).toEqual([
      'claude-code/one',
      'codex/two',
    ])
  })
})
