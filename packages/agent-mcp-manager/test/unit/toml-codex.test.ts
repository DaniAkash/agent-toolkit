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

  test('rejects non-stdio specs', () => {
    expect(() =>
      tomlCodexAdd('', 'x', { transport: 'http', url: 'https://x' }, CFG),
    ).toThrow(InvalidServerSpecError)
  })
})
