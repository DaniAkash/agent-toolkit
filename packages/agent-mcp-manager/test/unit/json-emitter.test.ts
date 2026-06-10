import { describe, expect, test } from 'bun:test'

import {
  jsonAdd,
  jsonRead,
  jsonRemove,
} from '../../src/emitters/json-emitter.ts'

const MCP_SERVERS = { parentKey: 'mcpServers' as const }
const VSCODE_SERVERS = {
  parentKey: 'servers' as const,
  injectFields: { type: 'stdio' },
}
const ZED_CONTEXT = {
  parentKey: 'context_servers' as const,
  injectFields: { source: 'custom', enabled: true },
}

describe('json emitter — mcpServers variant', () => {
  test('add into empty file creates parent + entry', () => {
    const out = jsonAdd(
      '',
      'github',
      { transport: 'stdio', command: 'npx', args: ['-y', 'gh-mcp'] },
      MCP_SERVERS,
    )
    const parsed = JSON.parse(out)
    expect(parsed.mcpServers.github).toEqual({
      command: 'npx',
      args: ['-y', 'gh-mcp'],
    })
  })

  test('add preserves siblings', () => {
    const seed = JSON.stringify(
      { mcpServers: { existing: { command: 'foo' } } },
      null,
      2,
    )
    const out = jsonAdd(
      seed,
      'github',
      { transport: 'stdio', command: 'npx' },
      MCP_SERVERS,
    )
    const parsed = JSON.parse(out)
    expect(parsed.mcpServers.existing).toEqual({ command: 'foo' })
    expect(parsed.mcpServers.github).toEqual({ command: 'npx' })
  })

  test('read returns server names', () => {
    const seed = JSON.stringify({
      mcpServers: { a: { command: 'x' }, b: { command: 'y' } },
    })
    expect(jsonRead(seed, MCP_SERVERS).sort()).toEqual(['a', 'b'])
  })

  test('remove drops the entry but leaves siblings', () => {
    const seed = JSON.stringify({
      mcpServers: { keep: { command: 'k' }, drop: { command: 'd' } },
    })
    const out = jsonRemove(seed, 'drop', MCP_SERVERS)
    const parsed = JSON.parse(out)
    expect(parsed.mcpServers.drop).toBeUndefined()
    expect(parsed.mcpServers.keep).toEqual({ command: 'k' })
  })

  test('read on empty input returns []', () => {
    expect(jsonRead('', MCP_SERVERS)).toEqual([])
  })

  test('JSONC comments survive add', () => {
    const seed = '// keep this comment\n{\n  "mcpServers": {}\n}\n'
    const out = jsonAdd(
      seed,
      'svc',
      { transport: 'stdio', command: 'x' },
      MCP_SERVERS,
    )
    expect(out).toContain('// keep this comment')
    // jsonc-parser's parse handles it
    expect(jsonRead(out, MCP_SERVERS)).toEqual(['svc'])
  })
})

describe('json emitter — VS Code servers variant', () => {
  test('injects type: stdio', () => {
    const out = jsonAdd(
      '',
      'github',
      { transport: 'stdio', command: 'gh-mcp' },
      VSCODE_SERVERS,
    )
    const parsed = JSON.parse(out)
    expect(parsed.servers.github).toEqual({ command: 'gh-mcp', type: 'stdio' })
  })

  test('read finds the entry under .servers', () => {
    const seed = JSON.stringify({
      servers: { gh: { type: 'stdio', command: 'x' } },
    })
    expect(jsonRead(seed, VSCODE_SERVERS)).toEqual(['gh'])
  })
})

describe('json emitter — Zed context_servers variant', () => {
  test('injects source + enabled', () => {
    const out = jsonAdd(
      '',
      'github',
      { transport: 'stdio', command: 'gh-mcp' },
      ZED_CONTEXT,
    )
    const parsed = JSON.parse(out)
    expect(parsed.context_servers.github).toEqual({
      command: 'gh-mcp',
      source: 'custom',
      enabled: true,
    })
  })
})

describe('json emitter — http transport', () => {
  test('emits url + headers, no command', () => {
    const out = jsonAdd(
      '',
      'remote',
      {
        transport: 'http',
        url: 'https://x.example/mcp',
        headers: { Authorization: 'Bearer x' },
      },
      MCP_SERVERS,
    )
    const parsed = JSON.parse(out)
    expect(parsed.mcpServers.remote).toEqual({
      url: 'https://x.example/mcp',
      headers: { Authorization: 'Bearer x' },
    })
  })
})
