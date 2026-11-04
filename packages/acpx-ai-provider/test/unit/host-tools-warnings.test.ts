/**
 * Warnings, and the metadata that tells a host tool call apart from an
 * agent-side one.
 *
 * The warning exists because of a hard limit in the AI SDK rather than a
 * choice: `LanguageModelV2FunctionTool` is `{ type, name, description,
 * inputSchema }` with no `execute`, so a provider given `tools` alone
 * cannot answer a call out of band. Passing `tools` without declaring the
 * function must say so, because the alternative is a tool that silently
 * never fires, which is the bug this whole feature is fixing.
 */
import { describe, expect, test } from 'bun:test'
import type {
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
} from '@ai-sdk/provider'
import { hostToolWarnings } from '../../src/host-tools/warnings.ts'

/**
 * `LanguageModelV2CallWarning` is a union and only its `other` variant
 * carries `message`. Narrowed here rather than cast, so a warning emitted
 * as the wrong variant fails the test instead of being papered over.
 */
function messageOf(warning: LanguageModelV2CallWarning | undefined): string {
  if (warning?.type === 'other') return warning.message
  return ''
}

type Tools = LanguageModelV2CallOptions['tools']

function fnTool(name: string): NonNullable<Tools>[number] {
  return {
    type: 'function',
    name,
    description: `the ${name} tool`,
    inputSchema: { type: 'object', properties: {} },
  }
}

describe('hostToolWarnings', () => {
  test('no tools passed means nothing to warn about', () => {
    expect(
      hostToolWarnings({
        tools: undefined,
        declared: [],
        sessionAlreadyLive: false,
      }),
    ).toEqual([])
    expect(
      hostToolWarnings({ tools: [], declared: [], sessionAlreadyLive: false }),
    ).toEqual([])
  })

  test('a tool with no declared executable is warned about by name', () => {
    const warnings = hostToolWarnings({
      tools: [fnTool('say'), fnTool('ask')],
      declared: [],
      sessionAlreadyLive: false,
    })
    expect(warnings).toHaveLength(1)
    expect(messageOf(warnings[0])).toContain('say, ask')
    // The message has to point at the fix, not just state the fault.
    expect(messageOf(warnings[0])).toContain('hostTools')
  })

  test('no warning when every passed tool is declared', () => {
    expect(
      hostToolWarnings({
        tools: [fnTool('say')],
        declared: ['say'],
        sessionAlreadyLive: false,
      }),
    ).toEqual([])
  })

  test('only the undeclared subset is named', () => {
    const warnings = hostToolWarnings({
      tools: [fnTool('say'), fnTool('ask')],
      declared: ['say'],
      sessionAlreadyLive: false,
    })
    expect(warnings).toHaveLength(1)
    expect(messageOf(warnings[0])).toContain('ask')
    expect(messageOf(warnings[0])).not.toContain('say, ask')
  })

  test('a live session warns that the tool set is already fixed', () => {
    // ACP freezes a session's MCP configuration at session/new, so a
    // caller editing hostTools mid-session is told it did not take rather
    // than left to infer it.
    const warnings = hostToolWarnings({
      tools: [fnTool('say')],
      declared: ['say'],
      sessionAlreadyLive: true,
    })
    expect(warnings).toHaveLength(1)
    expect(messageOf(warnings[0])).toContain('already live')
    expect(messageOf(warnings[0])).toContain('sessionKey')
  })

  test('both faults are reported together', () => {
    const warnings = hostToolWarnings({
      tools: [fnTool('say'), fnTool('ask')],
      declared: ['say'],
      sessionAlreadyLive: true,
    })
    expect(warnings).toHaveLength(2)
  })

  test('a live session with nothing servable does not warn about staleness', () => {
    // There is no stale configuration to complain about when none of the
    // tools could ever have been served.
    const warnings = hostToolWarnings({
      tools: [fnTool('ask')],
      declared: [],
      sessionAlreadyLive: true,
    })
    expect(warnings).toHaveLength(1)
    expect(messageOf(warnings[0])).toContain('not declared')
  })
})
