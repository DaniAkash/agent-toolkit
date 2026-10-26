/**
 * Claude Code's `local` scope.
 *
 * `claude mcp add -s local` is the client's DEFAULT scope, and it writes
 * `projects.<cwd>.mcpServers` inside ~/.claude.json: the same file the
 * user/system scope writes to, told apart only by the container. A tool
 * that cannot reach it cannot reproduce what a user gets from the CLI.
 *
 * The expected shape here was read off a real ~/.claude.json, where
 * per-project entries sit under `projects.<path>.mcpServers` alongside
 * the global `mcpServers` key.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeCode } from '../../src/_catalog/client-configs.ts'
import { validateCatalog } from '../../src/_catalog/validate.ts'
import { getEmitter } from '../../src/emitters/index.ts'
import { resolveShapes } from '../../src/emitters/shape.ts'
import { bind } from '../../src/index.ts'
import type { McpServerSpec } from '../../src/types.ts'

const ROOT = '/Users/example/code/thing'
const HTTP: McpServerSpec = {
  transport: 'http',
  url: 'http://127.0.0.1:9010/mcp',
}

describe('containerPath resolution', () => {
  test('system scope stays a one-segment path', () => {
    const shapes = resolveShapes(claudeCode, 'system')
    expect(shapes.containerPath).toEqual(['mcpServers'])
  })

  test('local scope substitutes the project root', () => {
    const shapes = resolveShapes(claudeCode, 'local', ROOT)
    expect(shapes.containerPath).toEqual(['projects', ROOT, 'mcpServers'])
  })

  test('local scope without a project root is refused', () => {
    expect(() => resolveShapes(claudeCode, 'local')).toThrow(
      /projectRoot is required/,
    )
  })
})

describe('local scope writes', () => {
  test('a server lands under projects.<root>.mcpServers', () => {
    const io = getEmitter(claudeCode, 'local', ROOT)
    const out = io.add('{}', 'browseros-neo', HTTP)
    const parsed = JSON.parse(out) as Record<string, unknown>
    const projects = parsed.projects as Record<string, unknown>
    const entry = projects[ROOT] as Record<string, unknown>
    const servers = entry.mcpServers as Record<string, unknown>
    expect(servers['browseros-neo']).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:9010/mcp',
    })
    // And nothing was written at the top level, which is the whole point.
    expect(parsed.mcpServers).toBeUndefined()
  })

  test('local and system scopes coexist in one file without collision', () => {
    const system = getEmitter(claudeCode, 'system')
    const local = getEmitter(claudeCode, 'local', ROOT)

    let doc = system.add('{}', 'global-one', HTTP)
    doc = local.add(doc, 'local-one', HTTP)

    expect(system.read(doc)).toEqual(['global-one'])
    expect(local.read(doc)).toEqual(['local-one'])

    // Removing the local entry must not disturb the global one.
    const afterLocalRemove = local.remove(doc, 'local-one')
    expect(system.read(afterLocalRemove)).toEqual(['global-one'])
    expect(local.read(afterLocalRemove)).toEqual([])
  })

  test('two project roots in one file stay independent', () => {
    const other = '/Users/example/code/other'
    const a = getEmitter(claudeCode, 'local', ROOT)
    const b = getEmitter(claudeCode, 'local', other)

    let doc = a.add('{}', 'for-a', HTTP)
    doc = b.add(doc, 'for-b', HTTP)

    expect(a.read(doc)).toEqual(['for-a'])
    expect(b.read(doc)).toEqual(['for-b'])
  })

  test('existing sibling keys under the project entry survive', () => {
    // Real ~/.claude.json project entries carry much more than
    // mcpServers; writing must not clobber it.
    const existing = JSON.stringify({
      projects: {
        [ROOT]: { allowedTools: ['Bash'], history: [{ display: 'x' }] },
      },
    })
    const io = getEmitter(claudeCode, 'local', ROOT)
    const out = io.add(existing, 'added', HTTP)
    const parsed = JSON.parse(out) as Record<string, unknown>
    const entry = (parsed.projects as Record<string, Record<string, unknown>>)[
      ROOT
    ]
    expect(entry?.allowedTools).toEqual(['Bash'])
    expect(entry?.history).toEqual([{ display: 'x' }])
    expect(entry?.mcpServers).toBeDefined()
  })
})

describe('catalog validation of local scope', () => {
  test('rejects a local container identical to the system one', () => {
    const errors = validateCatalog(
      [
        {
          ...claudeCode,
          local: { stdio: { topLevelKey: 'mcpServers' } },
        },
      ],
      new Date('2026-10-26'),
    )
    expect(errors.some((e) => e.path === 'local.stdio.containerPath')).toBe(
      true,
    )
  })

  test('rejects a local container with no project-root segment', () => {
    const errors = validateCatalog(
      [
        {
          ...claudeCode,
          local: {
            stdio: {
              topLevelKey: 'projects',
              containerPath: ['projects', 'shared', 'mcpServers'],
            },
          },
        },
      ],
      new Date('2026-10-26'),
    )
    expect(
      errors.some(
        (e) =>
          e.path === 'local.stdio.containerPath' &&
          e.message.includes('projectRoot'),
      ),
    ).toBe(true)
  })

  test('accepts the shipped claude-code entry', () => {
    const errors = validateCatalog([claudeCode], new Date('2026-10-26'))
    expect(errors).toEqual([])
  })
})

describe('removal honours the scope a link was created at', () => {
  // Reported in review. The manifest recorded only `configPath`, so
  // removal assumed `system`. For a `local` link that reads the right
  // file and then edits the wrong container inside it: in practice
  // jsonc-parser threw "Can not delete in empty document", and where it
  // did not throw the entry was left on disk while the manifest record
  // was deleted.
  let root: string
  let workspace: string
  let configPath: string
  let projectRoot: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'local-scope-'))
    workspace = join(root, 'ws')
    projectRoot = join(root, 'proj')
    await mkdir(workspace, { recursive: true })
    await mkdir(projectRoot, { recursive: true })
    configPath = join(root, 'claude.json')
    await writeFile(configPath, '{"numStartups":3}\n', 'utf8')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const HTTP_SRV = {
    name: 'srv',
    spec: { transport: 'http' as const, url: 'http://127.0.0.1:9/mcp' },
  }

  test('the link record carries its scope and project root', async () => {
    const api = bind(workspace)
    await api.link({
      server: HTTP_SRV,
      agent: 'claude-code',
      scope: 'local',
      projectRoot,
      configPath,
    })
    const manifest = JSON.parse(
      await readFile(join(workspace, 'manifest.json'), 'utf8'),
    ) as {
      servers: Record<
        string,
        { links: Record<string, { scope?: string; projectRoot?: string }> }
      >
    }
    const link = manifest.servers.srv?.links['claude-code']
    expect(link?.scope).toBe('local')
    expect(link?.projectRoot).toBe(projectRoot)
  })

  test('remove() deletes the local entry, not the system container', async () => {
    const api = bind(workspace)
    await api.link({
      server: HTTP_SRV,
      agent: 'claude-code',
      scope: 'local',
      projectRoot,
      configPath,
    })
    const summary = await api.remove({ serverName: 'srv' })
    expect(summary.unlinkedAgents).toEqual(['claude-code'])

    const after = JSON.parse(await readFile(configPath, 'utf8')) as {
      numStartups?: number
      projects?: Record<string, { mcpServers?: Record<string, unknown> }>
    }
    expect(after.projects?.[projectRoot]?.mcpServers?.srv).toBeUndefined()
    // The surrounding document is untouched.
    expect(after.numStartups).toBe(3)
  })

  test('unlink() without an explicit scope uses the recorded one', async () => {
    const api = bind(workspace)
    await api.link({
      server: HTTP_SRV,
      agent: 'claude-code',
      scope: 'local',
      projectRoot,
      configPath,
    })
    const summary = await api.unlink({
      serverName: 'srv',
      agent: 'claude-code',
    })
    expect(summary.removed).toBe(true)
    const after = JSON.parse(await readFile(configPath, 'utf8')) as {
      projects?: Record<string, { mcpServers?: Record<string, unknown> }>
    }
    expect(after.projects?.[projectRoot]?.mcpServers?.srv).toBeUndefined()
  })

  test('a system link still removes from the top-level container', async () => {
    const api = bind(workspace)
    await api.link({ server: HTTP_SRV, agent: 'claude-code', configPath })
    await api.remove({ serverName: 'srv' })
    const after = JSON.parse(await readFile(configPath, 'utf8')) as {
      mcpServers?: Record<string, unknown>
      numStartups?: number
    }
    expect(after.mcpServers?.srv).toBeUndefined()
    expect(after.numStartups).toBe(3)
  })
})
