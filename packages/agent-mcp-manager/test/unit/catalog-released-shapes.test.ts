/**
 * Pins the config shapes against the client releases they were verified
 * against, and the BOM behaviour the JSONC path gets for free.
 */
import { describe, expect, test } from 'bun:test'
import {
  claudeCode,
  copilotCli,
  devinCli,
  opencode,
} from '../../src/_catalog/client-configs.ts'
import { getEmitter } from '../../src/emitters/index.ts'
import type { McpServerSpec } from '../../src/types.ts'

/** Read one entry out of a parsed config, typed and optional. */
function entryAt(
  raw: string,
  container: string,
  name: string,
): Record<string, unknown> | undefined {
  const parsed = JSON.parse(raw) as Record<
    string,
    Record<string, Record<string, unknown>> | undefined
  >
  return parsed[container]?.[name]
}

const STDIO: McpServerSpec = {
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'pkg'],
}
const HTTP: McpServerSpec = {
  transport: 'http',
  url: 'https://mcp.example.com/mcp',
}

describe('OpenCode, released 1.x shape', () => {
  // Verified against opencode 1.19.4 (npm latest and homebrew stable) and
  // its first-party docs. An unreleased V2 nests servers under
  // `mcp.servers`; this pins the shape the released line documents.
  const io = getEmitter(opencode, 'system')

  test('servers sit directly under the mcp key', () => {
    const out = io.add('{}', 'ctx', STDIO)
    const parsed = JSON.parse(out) as Record<string, unknown>
    const mcp = parsed.mcp as Record<string, unknown>
    expect(mcp.ctx).toBeDefined()
    // Not nested under `servers`, which is the unreleased V2 layout.
    expect(mcp.servers).toBeUndefined()
  })

  test('stdio entries use the documented 1.x field names', () => {
    const out = io.add('{}', 'ctx', {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'pkg'],
      env: { KEY: 'v' },
    })
    const entry = entryAt(out, 'mcp', 'ctx')
    expect(entry?.type).toBe('local')
    expect(entry?.enabled).toBe(true)
    // command is one array, and env is renamed to environment.
    expect(entry?.command).toEqual(['npx', '-y', 'pkg'])
    expect(entry?.environment).toEqual({ KEY: 'v' })
    expect(entry?.env).toBeUndefined()
  })

  test('remote entries are tagged remote', () => {
    const out = io.add('{}', 'rem', HTTP)
    const entry = entryAt(out, 'mcp', 'rem')
    expect(entry?.type).toBe('remote')
    expect(entry?.url).toBe('https://mcp.example.com/mcp')
  })
})

describe('newly catalogued CLIs', () => {
  test('Copilot CLI tags stdio as local and http as http', () => {
    const io = getEmitter(copilotCli, 'system')
    const stdio = io.add('{}', 's', STDIO)
    expect(entryAt(stdio, 'mcpServers', 's')?.type).toBe('local')
    const http = io.add('{}', 'h', HTTP)
    expect(entryAt(http, 'mcpServers', 'h')?.type).toBe('http')
  })

  test('Devin CLI writes bare stdio entries and tags remotes with transport', () => {
    const io = getEmitter(devinCli, 'system')
    const stdio = io.add('{}', 's', STDIO)
    // Documented shape is bare command/args/env with no type field.
    expect(entryAt(stdio, 'mcpServers', 's')?.type).toBeUndefined()
    expect(entryAt(stdio, 'mcpServers', 's')?.command).toBe('npx')

    const http = io.add('{}', 'h', HTTP)
    // Devin spells the discriminator `transport`, not `type`.
    expect(entryAt(http, 'mcpServers', 'h')?.transport).toBe('http')
    expect(entryAt(http, 'mcpServers', 'h')?.type).toBeUndefined()
  })
})

describe('UTF-8 BOM handling in the JSONC path', () => {
  // BrowserOS had to add explicit BOM strip/restore to their Rust port of
  // this catalog, because their emitter hand-rolls the CST walk. The
  // TypeScript path gets it from jsonc-parser. Pinned here so a future
  // parser swap cannot regress it silently.
  const io = getEmitter(claudeCode, 'system')
  const BOM = '﻿'

  test('a BOM-prefixed config is read, written and keeps its BOM', () => {
    const raw = `${BOM}{\n  // a comment\n  "mcpServers": { "existing": { "type": "http", "url": "u" } }\n}\n`
    expect(io.read(raw)).toEqual(['existing'])

    const out = io.add(raw, 'added', HTTP)
    expect(out.startsWith(BOM)).toBe(true)
    expect(out).toContain('// a comment')
    expect(io.read(out).sort()).toEqual(['added', 'existing'])
  })

  test('removing from a BOM-prefixed config keeps the BOM and comments', () => {
    const raw = `${BOM}{\n  // keep\n  "mcpServers": { "a": { "type": "http", "url": "u" }, "b": { "type": "http", "url": "u" } }\n}\n`
    const out = io.remove(raw, 'a')
    expect(out.startsWith(BOM)).toBe(true)
    expect(out).toContain('// keep')
    expect(io.read(out)).toEqual(['b'])
  })
})
