/**
 * The MCP surface, driven as a pure function.
 *
 * The handler is deliberately a `(Request) => Response`, so these tests
 * exercise the real protocol path with no server, no port and no agent:
 * exactly what the agent sends, exactly what it gets back.
 *
 * Method shapes here are the ones a real codex-acp handshake produced,
 * not invented from the spec: `initialize` proposing `2025-06-18`, then
 * `notifications/initialized`, then `tools/list`, then `tools/call`.
 */
import { describe, expect, test } from 'bun:test'
import {
  createHostToolHandler,
  DEFAULT_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '../../src/host-tools/handler.ts'
import type { AcpxHostTool } from '../../src/host-tools/types.ts'

const TOKEN = 'test-token'

function makeHandler(
  tools: Record<string, AcpxHostTool>,
  opts: { signal?: AbortSignal; onCall?: (n: string, id: string) => void } = {},
) {
  return createHostToolHandler({
    tools,
    token: TOKEN,
    serverName: 'host',
    serverVersion: '1',
    sessionKey: 'sess-1',
    getAbortSignal: () => opts.signal ?? new AbortController().signal,
    onCall: opts.onCall,
  })
}

function rpc(
  method: string,
  params?: Record<string, unknown>,
  id: number | string | null = 1,
  token = TOKEN,
) {
  return new Request('http://127.0.0.1/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      // The header codex actually sends; SSE is offered, not required.
      accept: 'text/event-stream, application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
}

const ECHO: AcpxHostTool = {
  description: 'Echo a message back to the host.',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
    additionalProperties: false,
  },
  execute: (input) => `got ${String(input.message)}`,
}

describe('authorization', () => {
  test('a request without the bearer token is refused', async () => {
    const res = await makeHandler({ echo: ECHO })(
      rpc('tools/list', undefined, 1, 'wrong-token'),
    )
    expect(res.status).toBe(401)
  })

  test('a non-POST method is refused rather than left hanging', async () => {
    // Codex never opens a GET event stream, and nothing here pushes, so
    // answering 405 is what stops a client waiting on one.
    const res = await makeHandler({ echo: ECHO })(
      new Request('http://127.0.0.1/mcp', {
        method: 'GET',
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    )
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })
})

describe('protocol version constants', () => {
  test('the default is the newest supported version', () => {
    // They are written as separate literals because
    // `isolatedDeclarations` cannot infer an exported `as const` array
    // built from another binding. This is what stops them drifting.
    expect(SUPPORTED_PROTOCOL_VERSIONS[0]).toBe(DEFAULT_PROTOCOL_VERSION)
  })

  test('every supported version is a dated revision', () => {
    for (const v of SUPPORTED_PROTOCOL_VERSIONS) {
      expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})

describe('initialize', () => {
  test('a supported proposed version is accepted', async () => {
    const res = await makeHandler({ echo: ECHO })(
      rpc('initialize', { protocolVersion: '2025-06-18' }),
    )
    const body = (await res.json()) as { result: { protocolVersion: string } }
    expect(body.result.protocolVersion).toBe('2025-06-18')
  })

  test('an unknown proposed version falls back to one we implement', async () => {
    // Echoing the proposal back would claim conformance to a revision
    // this server has never seen.
    const res = await makeHandler({ echo: ECHO })(
      rpc('initialize', { protocolVersion: '2099-01-01' }),
    )
    const body = (await res.json()) as { result: { protocolVersion: string } }
    expect(body.result.protocolVersion).toBe(DEFAULT_PROTOCOL_VERSION)
  })

  test('serverInfo and tool capability are advertised', async () => {
    const res = await makeHandler({ echo: ECHO })(rpc('initialize'))
    const body = (await res.json()) as {
      result: {
        serverInfo: { name: string; version: string }
        capabilities: { tools: unknown }
      }
    }
    expect(body.result.serverInfo.name).toBe('host')
    expect(body.result.capabilities.tools).toBeDefined()
  })
})

describe('notifications', () => {
  test('notifications/initialized is accepted with no body', async () => {
    const res = await makeHandler({ echo: ECHO })(
      rpc('notifications/initialized', undefined, null),
    )
    expect(res.status).toBe(202)
  })
})

describe('tools/list', () => {
  test('each tool is listed with its description and schema', async () => {
    const res = await makeHandler({ echo: ECHO })(rpc('tools/list'))
    const body = (await res.json()) as {
      result: {
        tools: Array<{
          name: string
          description: string
          inputSchema: unknown
        }>
      }
    }
    expect(body.result.tools).toHaveLength(1)
    const [tool] = body.result.tools
    expect(tool?.name).toBe('echo')
    // The description is the only channel to the model on an agent that
    // cannot take a system prompt, so it must survive verbatim.
    expect(tool?.description).toBe('Echo a message back to the host.')
    expect(tool?.inputSchema).toEqual(ECHO.inputSchema)
  })
})

describe('tools/call', () => {
  test('a valid call reaches execute and returns its value as content', async () => {
    const res = await makeHandler({ echo: ECHO })(
      rpc('tools/call', { name: 'echo', arguments: { message: 'hi' } }),
    )
    const body = (await res.json()) as {
      result: {
        content: Array<{ type: string; text: string }>
        isError: boolean
      }
    }
    expect(body.result.isError).toBe(false)
    expect(body.result.content[0]?.text).toBe('got hi')
  })

  test('execute receives the parsed arguments, not a text blob', async () => {
    // The whole reason for calling out of band: the stream collapses input
    // and result into one string, where this hands over real JSON.
    let seen: unknown
    const handler = makeHandler({
      echo: {
        ...ECHO,
        execute: (input) => {
          seen = input
          return 'ok'
        },
      },
    })
    await handler(
      rpc('tools/call', { name: 'echo', arguments: { message: 'hi' } }),
    )
    expect(seen).toEqual({ message: 'hi' })
  })

  test('a wrongly typed argument is rejected, not passed to execute', async () => {
    // Regression for what the codex probe actually did: it answered a
    // declared `{ type: 'string' }` with the number 42. Host code must
    // never see that.
    let called = false
    const handler = makeHandler({
      echo: {
        ...ECHO,
        execute: () => {
          called = true
          return 'ok'
        },
      },
    })
    const res = await handler(
      rpc('tools/call', { name: 'echo', arguments: { message: 42 } }),
    )
    const body = (await res.json()) as {
      result: { isError: boolean; content: Array<{ text: string }> }
    }
    expect(called).toBe(false)
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0]?.text).toContain('expected string')
    expect(body.result.content[0]?.text).toContain('received integer')
  })

  test('a missing required argument is reported by name', async () => {
    const res = await makeHandler({ echo: ECHO })(
      rpc('tools/call', { name: 'echo', arguments: {} }),
    )
    const body = (await res.json()) as {
      result: { isError: boolean; content: Array<{ text: string }> }
    }
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0]?.text).toContain('message: is required')
  })

  test('an unknown property is rejected when additionalProperties is false', async () => {
    const res = await makeHandler({ echo: ECHO })(
      rpc('tools/call', {
        name: 'echo',
        arguments: { message: 'hi', extra: 1 },
      }),
    )
    const body = (await res.json()) as { result: { isError: boolean } }
    expect(body.result.isError).toBe(true)
  })

  test('a rejecting execute becomes a tool error, not a protocol error', async () => {
    // The agent is meant to read this and decide what to do; a JSON-RPC
    // error would collapse the turn instead.
    const res = await makeHandler({
      boom: {
        ...ECHO,
        execute: () => {
          throw new Error('host blew up')
        },
      },
    })(rpc('tools/call', { name: 'boom', arguments: { message: 'x' } }))
    const body = (await res.json()) as {
      error?: unknown
      result?: { isError: boolean; content: Array<{ text: string }> }
    }
    expect(body.error).toBeUndefined()
    expect(body.result?.isError).toBe(true)
    expect(body.result?.content[0]?.text).toContain('host blew up')
  })

  test('an object return value is serialised as JSON text', async () => {
    const res = await makeHandler({
      obj: { ...ECHO, execute: () => ({ ok: true, n: 2 }) },
    })(rpc('tools/call', { name: 'obj', arguments: { message: 'x' } }))
    const body = (await res.json()) as {
      result: { content: Array<{ text: string }> }
    }
    expect(JSON.parse(body.result.content[0]?.text ?? '{}')).toEqual({
      ok: true,
      n: 2,
    })
  })

  test('a value that cannot be serialised still answers the agent', async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const res = await makeHandler({
      cyc: { ...ECHO, execute: () => cyclic },
    })(rpc('tools/call', { name: 'cyc', arguments: { message: 'x' } }))
    const body = (await res.json()) as {
      result: { isError: boolean; content: Array<{ text: string }> }
    }
    expect(body.result.isError).toBe(false)
    expect(typeof body.result.content[0]?.text).toBe('string')
  })

  test('an unknown tool name is a method-not-found error', async () => {
    const res = await makeHandler({ echo: ECHO })(
      rpc('tools/call', { name: 'nope', arguments: {} }),
    )
    const body = (await res.json()) as { error: { code: number } }
    expect(body.error.code).toBe(-32601)
  })

  test('onCall fires before execute, so the stream can be annotated', async () => {
    const order: string[] = []
    const handler = makeHandler(
      {
        echo: {
          ...ECHO,
          execute: () => {
            order.push('execute')
            return 'ok'
          },
        },
      },
      { onCall: (name) => order.push(`onCall:${name}`) },
    )
    await handler(
      rpc('tools/call', { name: 'echo', arguments: { message: 'hi' } }),
    )
    expect(order).toEqual(['onCall:echo', 'execute'])
  })

  test('the turn abort signal is handed to execute', async () => {
    const controller = new AbortController()
    let sawAborted: boolean | undefined
    const handler = makeHandler(
      {
        echo: {
          ...ECHO,
          execute: (_i, ctx) => {
            sawAborted = ctx.abortSignal.aborted
            return 'ok'
          },
        },
      },
      { signal: controller.signal },
    )
    controller.abort(new Error('turn cancelled'))
    await handler(
      rpc('tools/call', { name: 'echo', arguments: { message: 'hi' } }),
    )
    expect(sawAborted).toBe(true)
  })

  test('a per-tool timeoutMs bounds a hanging tool', async () => {
    // Opt-in only: the default is no ceiling, because an agent waiting on
    // a human answer is doing what it was asked.
    const res = await makeHandler({
      slow: {
        ...ECHO,
        timeoutMs: 20,
        execute: () => new Promise(() => {}),
      },
    })(rpc('tools/call', { name: 'slow', arguments: { message: 'x' } }))
    const body = (await res.json()) as {
      result: { isError: boolean; content: Array<{ text: string }> }
    }
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0]?.text).toContain('20ms timeout')
  })

  test('a tool with no timeoutMs is not bounded by one', async () => {
    const res = await makeHandler({
      patient: {
        ...ECHO,
        execute: async () => {
          await new Promise((r) => setTimeout(r, 60))
          return 'waited'
        },
      },
    })(rpc('tools/call', { name: 'patient', arguments: { message: 'x' } }))
    const body = (await res.json()) as {
      result: { isError: boolean; content: Array<{ text: string }> }
    }
    expect(body.result.isError).toBe(false)
    expect(body.result.content[0]?.text).toBe('waited')
  })
})

describe('required properties are own properties', () => {
  // Reported in review: `key in value` walks the prototype chain, so a
  // schema requiring `toString` saw `{}` as satisfying it and `execute`
  // then received no own argument at all.
  const PROTO_TOOL: AcpxHostTool = {
    description: 'Takes a property that also exists on Object.prototype.',
    inputSchema: {
      type: 'object',
      properties: { toString: { type: 'string' } },
      required: ['toString'],
    },
    execute: (input) => `got ${String(input.toString)}`,
  }

  test('an inherited property does not satisfy required', async () => {
    let called = false
    const res = await makeHandler({
      proto: {
        ...PROTO_TOOL,
        execute: () => {
          called = true
          return 'ok'
        },
      },
    })(rpc('tools/call', { name: 'proto', arguments: {} }))
    const body = (await res.json()) as {
      result: { isError: boolean; content: Array<{ text: string }> }
    }
    expect(called).toBe(false)
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0]?.text).toContain('toString: is required')
  })

  test('an own property of the same name is accepted', async () => {
    const res = await makeHandler({ proto: PROTO_TOOL })(
      rpc('tools/call', { name: 'proto', arguments: { toString: 'mine' } }),
    )
    const body = (await res.json()) as {
      result: { isError: boolean; content: Array<{ text: string }> }
    }
    expect(body.result.isError).toBe(false)
    expect(body.result.content[0]?.text).toBe('got mine')
  })
})

describe('timeoutMs is a response deadline', () => {
  test('the agent is answered but execute keeps running', async () => {
    // Reported in review, and true: a promise cannot be cancelled from
    // outside. Asserted rather than glossed, since the type now says so.
    let finished = false
    const res = await makeHandler({
      slow: {
        ...ECHO,
        timeoutMs: 20,
        execute: async () => {
          await new Promise((r) => setTimeout(r, 80))
          finished = true
          return 'late'
        },
      },
    })(rpc('tools/call', { name: 'slow', arguments: { message: 'x' } }))
    const body = (await res.json()) as { result: { isError: boolean } }
    expect(body.result.isError).toBe(true)
    // Still running at the moment the agent was answered.
    expect(finished).toBe(false)
    await new Promise((r) => setTimeout(r, 120))
    // And it ran to completion afterwards, which is why the docs say the
    // abort signal is the only real bound.
    expect(finished).toBe(true)
  })
})

describe('malformed input', () => {
  test('a body that is not JSON is a parse error', async () => {
    const res = await makeHandler({ echo: ECHO })(
      new Request('http://127.0.0.1/mcp', {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: 'not json',
      }),
    )
    const body = (await res.json()) as { error: { code: number } }
    expect(body.error.code).toBe(-32700)
  })

  test('a request with no method is an invalid request', async () => {
    const res = await makeHandler({ echo: ECHO })(
      new Request('http://127.0.0.1/mcp', {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1 }),
      }),
    )
    const body = (await res.json()) as { error: { code: number } }
    expect(body.error.code).toBe(-32600)
  })

  test('an unsupported method is reported rather than ignored', async () => {
    const res = await makeHandler({ echo: ECHO })(rpc('resources/list'))
    const body = (await res.json()) as { error: { code: number } }
    expect(body.error.code).toBe(-32601)
  })
})
