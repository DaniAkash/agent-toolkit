import { describe, expect, test } from 'bun:test'
import { toRuntimeMcpServers } from '../../src/bridge/mcp-servers.ts'

describe('toRuntimeMcpServers', () => {
  test('returns undefined for empty / missing input', () => {
    expect(toRuntimeMcpServers(undefined)).toBeUndefined()
    expect(toRuntimeMcpServers([])).toBeUndefined()
  })

  test('translates a stdio server, defaulting args to []', () => {
    const out = toRuntimeMcpServers([
      { type: 'stdio', name: 'fs', command: 'mcp-fs' },
    ])
    expect(out).toEqual([{ name: 'fs', command: 'mcp-fs', args: [], env: [] }])
  })

  test('translates env record into ACP HttpHeader-shaped entries', () => {
    const out = toRuntimeMcpServers([
      {
        type: 'stdio',
        name: 'fs',
        command: 'mcp-fs',
        args: ['--root', '/tmp'],
        env: { LOG: 'debug', RATE: '5' },
      },
    ])
    expect(out?.[0]).toMatchObject({
      args: ['--root', '/tmp'],
      env: [
        { name: 'LOG', value: 'debug' },
        { name: 'RATE', value: '5' },
      ],
    })
  })

  test('translates http server preserving type + url + headers', () => {
    const out = toRuntimeMcpServers([
      {
        type: 'http',
        name: 'remote',
        url: 'https://mcp.example.com',
        headers: { Authorization: 'Bearer x' },
      },
    ])
    expect(out?.[0]).toMatchObject({
      type: 'http',
      name: 'remote',
      url: 'https://mcp.example.com',
      headers: [{ name: 'Authorization', value: 'Bearer x' }],
    })
  })

  test('translates sse server preserving type', () => {
    const out = toRuntimeMcpServers([
      { type: 'sse', name: 'events', url: 'https://mcp.example.com/sse' },
    ])
    expect(out?.[0]).toMatchObject({ type: 'sse', headers: [] })
  })
})
