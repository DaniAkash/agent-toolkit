/**
 * The bound server: a real loopback listener, driven over real HTTP.
 *
 * `handler.test.ts` covers the protocol as a pure function; this covers
 * the part that only a socket can show, which is that the thing binds on
 * an ephemeral port, that its token actually gates it on the wire, and
 * that closing it releases the port.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { startHostToolServer } from '../../src/host-tools/serve.ts'
import type { AcpxHostTool } from '../../src/host-tools/types.ts'

const SAY: AcpxHostTool = {
  description: 'Say something to the host.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  execute: (input) => `said: ${String(input.text)}`,
}

const servers: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close()
})

async function start(tools: Record<string, AcpxHostTool> = { say: SAY }) {
  const server = await startHostToolServer({
    tools,
    serverName: 'host',
    serverVersion: '1',
    sessionKey: 'sess-1',
    getAbortSignal: () => new AbortController().signal,
  })
  servers.push(server)
  return server
}

function post(
  url: string,
  token: string,
  method: string,
  params?: Record<string, unknown>,
) {
  return fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
}

describe('startHostToolServer', () => {
  test('binds loopback on an ephemeral port', async () => {
    const server = await start()
    expect(server.port).toBeGreaterThan(0)
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/mcp`)
    expect(server.token.length).toBeGreaterThan(16)
  })

  test('two servers get different ports and different tokens', async () => {
    const a = await start()
    const b = await start()
    expect(a.port).not.toBe(b.port)
    expect(a.token).not.toBe(b.token)
  })

  test('serves a full initialize, list, call sequence over the wire', async () => {
    const server = await start()

    const init = await post(server.url, server.token, 'initialize', {
      protocolVersion: '2025-06-18',
    })
    expect(init.status).toBe(200)

    const list = await post(server.url, server.token, 'tools/list')
    const listed = (await list.json()) as {
      result: { tools: Array<{ name: string }> }
    }
    expect(listed.result.tools.map((t) => t.name)).toEqual(['say'])

    const call = await post(server.url, server.token, 'tools/call', {
      name: 'say',
      arguments: { text: 'hello' },
    })
    const called = (await call.json()) as {
      result: { content: Array<{ text: string }> }
    }
    expect(called.result.content[0]?.text).toBe('said: hello')
  })

  test('the wrong token is refused on the wire', async () => {
    const server = await start()
    const res = await post(server.url, 'not-the-token', 'tools/list')
    expect(res.status).toBe(401)
  })

  test('close releases the port', async () => {
    const server = await start()
    const { url, token } = server
    await server.close()
    servers.pop()

    let refused = false
    try {
      await post(url, token, 'tools/list')
    } catch {
      refused = true
    }
    expect(refused).toBe(true)
  })
})
