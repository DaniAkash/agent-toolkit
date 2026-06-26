import { describe, expect, test } from 'bun:test'

import {
  tomlCodexAdd,
  tomlCodexRead,
  tomlCodexRemove,
} from '../../src/emitters/toml-codex-emitter.ts'
import { InvalidServerSpecError } from '../../src/errors.ts'

const CFG = { tableKey: 'mcp_servers' as const }

describe('toml-codex emitter', () => {
  test('add writes [mcp_servers.NAME] table', () => {
    const out = tomlCodexAdd(
      '',
      'github',
      { transport: 'stdio', command: 'gh-mcp', args: ['serve'] },
      CFG,
    )
    expect(out).toContain('[mcp_servers.github]')
    expect(out).toContain('command = "gh-mcp"')
    // @iarna/toml emits arrays with surrounding whitespace: `args = [ "serve" ]`
    expect(out).toMatch(/args = \[\s*"serve"\s*\]/)
  })

  test('add then read round-trip', () => {
    const after = tomlCodexAdd(
      '',
      'a',
      { transport: 'stdio', command: 'x' },
      CFG,
    )
    const after2 = tomlCodexAdd(
      after,
      'b',
      { transport: 'stdio', command: 'y' },
      CFG,
    )
    expect(tomlCodexRead(after2, CFG).sort()).toEqual(['a', 'b'])
  })

  test('remove leaves siblings intact', () => {
    let raw = tomlCodexAdd('', 'a', { transport: 'stdio', command: 'x' }, CFG)
    raw = tomlCodexAdd(raw, 'b', { transport: 'stdio', command: 'y' }, CFG)
    const after = tomlCodexRemove(raw, 'a', CFG)
    expect(tomlCodexRead(after, CFG)).toEqual(['b'])
  })

  test('remove last entry drops the parent table', () => {
    const raw = tomlCodexAdd(
      '',
      'solo',
      { transport: 'stdio', command: 'x' },
      CFG,
    )
    const after = tomlCodexRemove(raw, 'solo', CFG)
    expect(tomlCodexRead(after, CFG)).toEqual([])
    expect(after).not.toContain('mcp_servers')
  })

  test('http spec writes url and omits command/args', () => {
    const out = tomlCodexAdd(
      '',
      'figma',
      { transport: 'http', url: 'https://mcp.figma.com/mcp' },
      CFG,
    )
    expect(out).toContain('[mcp_servers.figma]')
    expect(out).toContain('url = "https://mcp.figma.com/mcp"')
    expect(out).not.toContain('command =')
    expect(out).not.toContain('args =')
  })

  test('http spec with headers serialises http_headers as a sub-table', () => {
    const out = tomlCodexAdd(
      '',
      'figma',
      {
        transport: 'http',
        url: 'https://mcp.figma.com/mcp',
        headers: { 'X-Figma-Region': 'us-east-1' },
      },
      CFG,
    )
    expect(out).toContain('http_headers')
    expect(out).toContain('X-Figma-Region')
    expect(out).toContain('us-east-1')
  })

  test('http spec without headers omits the http_headers key entirely', () => {
    const out = tomlCodexAdd(
      '',
      'remote',
      { transport: 'http', url: 'https://example.com/mcp' },
      CFG,
    )
    expect(out).not.toContain('http_headers')
  })

  test('http spec round-trips through tomlCodexRead', () => {
    const out = tomlCodexAdd(
      '',
      'figma',
      { transport: 'http', url: 'https://mcp.figma.com/mcp' },
      CFG,
    )
    expect(tomlCodexRead(out, CFG)).toEqual(['figma'])
  })

  test('stdio and http entries coexist under the same mcp_servers table', () => {
    let raw = tomlCodexAdd(
      '',
      'context7',
      { transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
      CFG,
    )
    raw = tomlCodexAdd(
      raw,
      'figma',
      { transport: 'http', url: 'https://mcp.figma.com/mcp' },
      CFG,
    )
    expect(tomlCodexRead(raw, CFG).sort()).toEqual(['context7', 'figma'])
    expect(raw).toContain('command = "npx"')
    expect(raw).toContain('url = "https://mcp.figma.com/mcp"')
  })

  test('sse spec still throws InvalidServerSpecError', () => {
    expect(() =>
      tomlCodexAdd(
        '',
        'sse-svc',
        { transport: 'sse', url: 'https://example.com/sse' },
        CFG,
      ),
    ).toThrow(InvalidServerSpecError)
  })
})
