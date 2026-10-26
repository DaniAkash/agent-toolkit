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
import { describe, expect, test } from 'bun:test'
import { claudeCode } from '../../src/_catalog/client-configs.ts'
import { validateCatalog } from '../../src/_catalog/validate.ts'
import { getEmitter } from '../../src/emitters/index.ts'
import { resolveShapes } from '../../src/emitters/shape.ts'
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
