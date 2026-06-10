import { describe, expect, test } from 'bun:test'

import {
  isAgentSupported,
  listSupportedAgents,
  resolveAgentMcpConfigPath,
} from '../../src/agents.ts'
import { UnresolvedConfigPathError } from '../../src/errors.ts'

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
