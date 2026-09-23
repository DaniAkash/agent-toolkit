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

  // Standard names an agent has no mapping for. Blanket coverage stopped
  // being true once the standard grew a capability that not every agent
  // exposes: upstream's own codex adapter declares only `bash` and
  // `webSearch`. Listing the gaps per agent keeps the assertion sharp, since
  // a newly standardised tool still fails this test until someone decides,
  // agent by agent, whether it maps.
  const UNMAPPED_BY_AGENT: Readonly<Record<string, ReadonlySet<string>>> = {
    claude: new Set(),
    // Codex exposes no ask-the-user tool; upstream's codex adapter does not
    // declare one either.
    codex: new Set(['askUserQuestions']),
    // Gemini's equivalent, if it has one, is unconfirmed. Left unmapped
    // rather than guessed at.
    gemini: new Set(['askUserQuestions']),
  }

  test('every supported agent covers every standard name it maps', () => {
    for (const agent of supportedAgents) {
      const table = NATIVE_TO_COMMON_BY_AGENT[agent]
      const covered = new Set(Object.values(table ?? {}))
      const unmapped = UNMAPPED_BY_AGENT[agent] ?? new Set<string>()
      for (const name of HARNESS_V1_BUILTIN_TOOL_NAMES) {
        // Asserting the negative too, so the exclusion list cannot go stale:
        // adding a mapping without removing its entry here fails loudly.
        expect(covered.has(name)).toBe(!unmapped.has(name))
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
