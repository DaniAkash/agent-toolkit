import { describe, expect, test } from 'bun:test'
import {
  autoSessionName,
  SESSION_NAME_PREFIX,
  sessionSandboxName,
} from '../../src/internal/session-name.ts'

describe('sessionSandboxName', () => {
  test('prefixes the session id with the harness slug', () => {
    expect(sessionSandboxName('hello')).toBe(`${SESSION_NAME_PREFIX}-hello`)
  })

  test('preserves dashes and digits', () => {
    expect(sessionSandboxName('session-42-x')).toBe(
      `${SESSION_NAME_PREFIX}-session-42-x`,
    )
  })

  test('slugifies disallowed characters with dashes', () => {
    expect(sessionSandboxName('foo/bar:baz qux')).toBe(
      `${SESSION_NAME_PREFIX}-foo-bar-baz-qux`,
    )
  })

  test('truncates names that exceed 128 UTF-8 bytes', () => {
    const overlong = sessionSandboxName('a'.repeat(200))
    expect(overlong.length).toBeLessThanOrEqual(128)
    expect(overlong.startsWith(SESSION_NAME_PREFIX)).toBe(true)
  })

  test('handles unicode without exceeding the byte budget', () => {
    // Each star is 4 UTF-8 bytes; 40 of them = 160 bytes before prefix.
    const name = sessionSandboxName('⭐'.repeat(40))
    expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(128)
  })
})

describe('autoSessionName', () => {
  test('starts with the auto prefix', () => {
    expect(autoSessionName().startsWith(`${SESSION_NAME_PREFIX}-auto-`)).toBe(
      true,
    )
  })

  test('produces distinct names across rapid calls', () => {
    const names = new Set(Array.from({ length: 100 }, () => autoSessionName()))
    expect(names.size).toBe(100)
  })

  test('respects the 128-byte cap', () => {
    expect(autoSessionName().length).toBeLessThanOrEqual(128)
  })
})
