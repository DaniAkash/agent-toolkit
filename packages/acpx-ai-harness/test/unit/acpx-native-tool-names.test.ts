import { describe, expect, test } from 'bun:test'
import { HARNESS_V1_BUILTIN_TOOL_NAMES } from '@ai-sdk/harness'
import {
  NATIVE_TO_COMMON_BY_AGENT,
  toCommonToolName,
} from '../../src/acpx-native-tool-names.ts'

describe('toCommonToolName', () => {
  test("claude's Bash -> common bash", () => {
    expect(toCommonToolName('claude', 'Bash')).toBe('bash')
  })

  test("codex's shell -> common bash", () => {
    expect(toCommonToolName('codex', 'shell')).toBe('bash')
  })

  test("gemini's run_shell_command -> common bash", () => {
    expect(toCommonToolName('gemini', 'run_shell_command')).toBe('bash')
  })

  test('all three agents map their read tool to common read', () => {
    expect(toCommonToolName('claude', 'Read')).toBe('read')
    expect(toCommonToolName('codex', 'read')).toBe('read')
    expect(toCommonToolName('gemini', 'read_file')).toBe('read')
  })

  test('all three agents map their web-search tool to common webSearch', () => {
    expect(toCommonToolName('claude', 'WebSearch')).toBe('webSearch')
    expect(toCommonToolName('codex', 'web_search')).toBe('webSearch')
    expect(toCommonToolName('gemini', 'google_web_search')).toBe('webSearch')
  })

  test('unmapped agent passes the native name through', () => {
    expect(toCommonToolName('unknown-agent', 'CustomTool')).toBe('CustomTool')
  })

  test('unmapped tool on a known agent passes through', () => {
    expect(toCommonToolName('claude', 'TodoWrite')).toBe('TodoWrite')
  })
})

describe('NATIVE_TO_COMMON_BY_AGENT', () => {
  const supportedAgents = ['claude', 'codex', 'gemini'] as const

  test('every supported agent covers every standard common-tool name', () => {
    for (const agent of supportedAgents) {
      const table = NATIVE_TO_COMMON_BY_AGENT[agent]
      const covered = new Set(Object.values(table ?? {}))
      for (const name of HARNESS_V1_BUILTIN_TOOL_NAMES) {
        expect(covered.has(name)).toBe(true)
      }
    }
  })

  test('each agent maps its native names uniquely (no two natives -> same common)', () => {
    for (const agent of supportedAgents) {
      const table = NATIVE_TO_COMMON_BY_AGENT[agent] ?? {}
      const values = Object.values(table)
      expect(values.length).toBe(new Set(values).size)
    }
  })
})
