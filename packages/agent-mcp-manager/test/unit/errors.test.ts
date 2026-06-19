import { describe, expect, test } from 'bun:test'

import { McpManagerError, UnsupportedTransportError } from '../../src/errors.ts'

describe('UnsupportedTransportError', () => {
  test('extends McpManagerError so instanceof checks compose', () => {
    const err = new UnsupportedTransportError('claude-desktop', 'http', {
      supported: ['stdio'],
      hint: 'wrap with npx -y mcp-remote',
    })
    expect(err).toBeInstanceOf(McpManagerError)
    expect(err).toBeInstanceOf(UnsupportedTransportError)
    expect(err.name).toBe('UnsupportedTransportError')
  })

  test('exposes agent, transport, and supported list', () => {
    const err = new UnsupportedTransportError('codex', 'sse', {
      supported: ['stdio'],
      hint: 'use the mcp-remote shim',
    })
    expect(err.agent).toBe('codex')
    expect(err.transport).toBe('sse')
    expect(err.details.supported).toEqual(['stdio'])
    expect(err.details.hint).toContain('mcp-remote')
  })

  test('message names the requested transport and the supported set', () => {
    const err = new UnsupportedTransportError('claude-desktop', 'http', {
      supported: ['stdio'],
      hint: 'see README',
    })
    expect(err.message).toContain('claude-desktop')
    expect(err.message).toContain('"http"')
    expect(err.message).toContain('supported: stdio')
  })
})
