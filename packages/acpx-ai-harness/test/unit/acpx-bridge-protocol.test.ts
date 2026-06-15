import { describe, expect, test } from 'bun:test'
import {
  acpxBridgeMcpServerSchema,
  acpxBridgeStartMessageSchema,
} from '../../src/acpx-bridge-protocol.ts'

describe('acpxBridgeStartMessageSchema', () => {
  test('parses a minimal start frame', () => {
    const parsed = acpxBridgeStartMessageSchema.parse({
      type: 'start',
      prompt: 'hi',
      agent: 'claude',
      sessionKey: 'sess-1',
      cwd: '/tmp/work',
    })
    expect(parsed.agent).toBe('claude')
    expect(parsed.sessionKey).toBe('sess-1')
    expect(parsed.cwd).toBe('/tmp/work')
  })

  test('accepts optional acpx fields', () => {
    const parsed = acpxBridgeStartMessageSchema.parse({
      type: 'start',
      prompt: 'hi',
      agent: 'codex',
      sessionKey: 'sess-2',
      cwd: '/tmp/work',
      model: 'gpt-5',
      stateDir: '/var/acpx',
      continue: true,
    })
    expect(parsed.model).toBe('gpt-5')
    expect(parsed.stateDir).toBe('/var/acpx')
    expect(parsed.continue).toBe(true)
  })

  test('preserves the harness base fields (prompt, tools, permissionMode)', () => {
    const parsed = acpxBridgeStartMessageSchema.parse({
      type: 'start',
      prompt: 'hello',
      tools: [
        {
          name: 'lookup',
          description: 'fetch',
          inputSchema: { type: 'object' },
        },
      ],
      permissionMode: 'allow-reads',
      agent: 'claude',
      sessionKey: 's',
      cwd: '/tmp',
    })
    expect(parsed.tools?.[0]?.name).toBe('lookup')
    expect(parsed.permissionMode).toBe('allow-reads')
  })

  test('rejects a frame missing required acpx fields', () => {
    expect(() =>
      acpxBridgeStartMessageSchema.parse({
        type: 'start',
        prompt: 'hi',
        agent: 'claude',
      }),
    ).toThrow()
  })
})

describe('acpxBridgeMcpServerSchema', () => {
  test('parses a stdio server', () => {
    const parsed = acpxBridgeMcpServerSchema.parse({
      type: 'stdio',
      name: 'fs',
      command: 'mcp-fs',
      args: ['--root', '/tmp'],
      env: { LOG: 'debug' },
    })
    expect(parsed.type).toBe('stdio')
    if (parsed.type === 'stdio') {
      expect(parsed.command).toBe('mcp-fs')
      expect(parsed.args).toEqual(['--root', '/tmp'])
    }
  })

  test('parses an http server', () => {
    const parsed = acpxBridgeMcpServerSchema.parse({
      type: 'http',
      name: 'remote',
      url: 'https://mcp.example.com',
      headers: { Authorization: 'Bearer x' },
    })
    expect(parsed.type).toBe('http')
    if (parsed.type === 'http') {
      expect(parsed.url).toBe('https://mcp.example.com')
    }
  })

  test('rejects an unknown server type', () => {
    expect(() =>
      acpxBridgeMcpServerSchema.parse({
        type: 'websocket',
        name: 'x',
        url: 'ws://example.com',
      }),
    ).toThrow()
  })
})
