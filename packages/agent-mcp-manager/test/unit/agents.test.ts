import { describe, expect, test } from 'bun:test'

import {
  isAgentSupported,
  listSupportedAgents,
  resolveAgentMcpConfigPath,
  resolveAgentSurface,
} from '../../src/agents.ts'
import { UnresolvedConfigPathError } from '../../src/errors.ts'
import type { AgentId, McpTransport } from '../../src/types.ts'

describe('agents catalog', () => {
  test('listSupportedAgents returns the 7 v0.1 agents', () => {
    expect([...listSupportedAgents()].sort()).toEqual([
      'claude-code',
      'claude-desktop',
      'codex',
      'cursor',
      'gemini',
      'vscode',
      'zed',
    ])
  })

  test('isAgentSupported is a tight type guard', () => {
    expect(isAgentSupported('claude-code')).toBe(true)
    expect(isAgentSupported('totally-made-up')).toBe(false)
  })

  test('isAgentSupported rejects Object.prototype keys', () => {
    // The catalog used to use `in`, which leaked inherited keys like
    // `toString` / `hasOwnProperty` and let the type guard pass for them.
    expect(isAgentSupported('toString')).toBe(false)
    expect(isAgentSupported('hasOwnProperty')).toBe(false)
    expect(isAgentSupported('__proto__')).toBe(false)
    expect(isAgentSupported('constructor')).toBe(false)
  })

  test('resolveAgentMcpConfigPath in project scope requires projectRoot', async () => {
    await expect(
      resolveAgentMcpConfigPath('cursor', 'project'),
    ).rejects.toBeInstanceOf(UnresolvedConfigPathError)
  })

  test('resolveAgentMcpConfigPath in project scope yields <root>/<projectFile>', async () => {
    const p = await resolveAgentMcpConfigPath('cursor', 'project', '/tmp/proj')
    expect(p).toBe('/tmp/proj/.cursor/mcp.json')
  })

  test('resolveAgentMcpConfigPath in project scope errors for agents w/o project file', async () => {
    await expect(
      resolveAgentMcpConfigPath('codex', 'project', '/tmp/proj'),
    ).rejects.toBeInstanceOf(UnresolvedConfigPathError)
  })
})

describe('agent transport-capability surface', () => {
  const VALID: ReadonlyArray<McpTransport> = ['stdio', 'sse', 'http']

  test('every agent declares a non-empty subset of the transport union', () => {
    for (const id of listSupportedAgents()) {
      const { supportedTransports } = resolveAgentSurface(id)
      expect(supportedTransports.length).toBeGreaterThan(0)
      for (const t of supportedTransports) {
        expect(VALID).toContain(t)
      }
    }
  })

  test('claude-desktop is stdio-only', () => {
    expect(resolveAgentSurface('claude-desktop').supportedTransports).toEqual([
      'stdio',
    ])
  })

  test('codex is stdio-only', () => {
    expect(resolveAgentSurface('codex').supportedTransports).toEqual(['stdio'])
  })

  test('cursor accepts all three transports', () => {
    expect([...resolveAgentSurface('cursor').supportedTransports].sort()).toEqual(
      ['http', 'sse', 'stdio'],
    )
  })

  test('claude-code system scope accepts all three transports', () => {
    expect(
      [...resolveAgentSurface('claude-code', 'system').supportedTransports].sort(),
    ).toEqual(['http', 'sse', 'stdio'])
  })
})
