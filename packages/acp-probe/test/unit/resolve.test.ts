import { describe, expect, test } from 'bun:test'
import { AgentResolveError } from '../../src/errors.ts'
import {
  resolveAgentCommandFromId,
  splitArgv,
} from '../../src/resolve-command.ts'

describe('splitArgv', () => {
  test('simple whitespace split', () => {
    expect(splitArgv('npx -y package')).toEqual(['npx', '-y', 'package'])
  })

  test('preserves quoted substrings', () => {
    expect(splitArgv('cmd "hello world" tail')).toEqual([
      'cmd',
      'hello world',
      'tail',
    ])
    expect(splitArgv("cmd 'no escapes \\n inside' tail")).toEqual([
      'cmd',
      'no escapes \\n inside',
      'tail',
    ])
  })

  test('honors backslash escapes outside single quotes', () => {
    expect(splitArgv('cmd a\\ b c')).toEqual(['cmd', 'a b', 'c'])
  })

  test('collapses multiple whitespace', () => {
    expect(splitArgv('a   b\tc\nd')).toEqual(['a', 'b', 'c', 'd'])
  })

  test('returns empty array for empty input', () => {
    expect(splitArgv('')).toEqual([])
  })
})

describe('resolveAgentCommandFromId', () => {
  test('returns argv for a known acpx agent id when acpx is installed', async () => {
    // `acpx` is a devDep of this package and so is in node_modules during
    // tests. The resolver should succeed.
    const argv = await resolveAgentCommandFromId('claude')
    expect(argv.length).toBeGreaterThan(0)
    // Spawn command must reference the claude ACP adapter.
    expect(argv.some((a) => a.includes('claude'))).toBe(true)
  })

  test('throws AgentResolveError with unknown_agent for a bogus id', async () => {
    let thrown: unknown = null
    try {
      await resolveAgentCommandFromId('definitely-not-an-agent-xyz123')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(AgentResolveError)
    expect((thrown as AgentResolveError).resolveCause).toBe('unknown_agent')
  })
})
