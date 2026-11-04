/**
 * How the host tool server is wired into the provider's session lifecycle.
 *
 * The things that can only go wrong at this seam: the server must be bound
 * BEFORE `session/new` (acpx cannot swap MCP config on a live session), it
 * must be registered through the resolver form so one session does not
 * receive another's URL, a name collision must be loud, and `close()` must
 * release the port.
 *
 * `mock.module` is process-global and irreversible in bun, which is why
 * this file owns its own runtime stub and the suite runs with --isolate.
 */
import { describe, expect, mock, test } from 'bun:test'
import type { AcpRuntime, AcpRuntimeOptions } from 'acpx/runtime'
import type { AcpxHostTool } from '../../src/host-tools/types.ts'

interface Captured {
  options: AcpRuntimeOptions | undefined
  ensureSessionCalls: Array<Record<string, unknown>>
  /** mcpServers as resolved at the moment ensureSession was called. */
  mcpAtSessionTime: unknown
}

const captured: Captured = {
  options: undefined,
  ensureSessionCalls: [],
  mcpAtSessionTime: undefined,
}

const createAcpRuntimeMock = mock((options: AcpRuntimeOptions): AcpRuntime => {
  captured.options = options
  return {
    ensureSession: async (args: Record<string, unknown>) => {
      captured.ensureSessionCalls.push(args)
      // Resolve mcpServers exactly when acpx would, so the test sees what
      // the agent would actually be handed for this session.
      const spec = options.mcpServers
      captured.mcpAtSessionTime =
        typeof spec === 'function'
          ? spec({ sessionKey: args.sessionKey } as never)
          : spec
      return {}
    },
    startTurn: () => ({
      requestId: 'r',
      events: { [Symbol.asyncIterator]: async function* () {} },
      result: Promise.resolve({ status: 'completed' }),
      cancel: async () => {},
      closeStream: async () => {},
    }),
    cancel: async () => {},
    close: async () => {},
  } as unknown as AcpRuntime
})

mock.module('acpx/runtime', () => ({
  createAcpRuntime: createAcpRuntimeMock,
  createAgentRegistry: () => ({}),
  createFileSessionStore: () => ({}),
}))

const { createAcpxProvider } = await import('../../src/provider.ts')

const SAY: AcpxHostTool = {
  description: 'Say something.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  execute: () => 'ok',
}

function reset() {
  captured.options = undefined
  captured.ensureSessionCalls = []
  captured.mcpAtSessionTime = undefined
}

interface HttpEntry {
  type?: string
  name: string
  url?: string
  headers?: Array<{ name: string; value: string }>
}

describe('registration', () => {
  test('no hostTools means no extra MCP server', async () => {
    reset()
    const provider = createAcpxProvider({ agent: 'codex', sessionKey: 'k1' })
    await provider.prepare()
    expect(captured.mcpAtSessionTime).toEqual([])
    await provider.close('test')
  })

  test('a host tool server is registered for the session', async () => {
    reset()
    const provider = createAcpxProvider({
      agent: 'codex',
      sessionKey: 'k2',
      hostTools: { tools: { say: SAY } },
    })
    await provider.prepare()

    const entries = captured.mcpAtSessionTime as HttpEntry[]
    expect(entries).toHaveLength(1)
    const [entry] = entries
    expect(entry?.type).toBe('http')
    expect(entry?.name).toBe('host')
    expect(entry?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    // The bearer token rides in the ACP wire shape, not a plain record.
    expect(entry?.headers?.[0]?.name).toBe('Authorization')
    expect(entry?.headers?.[0]?.value).toMatch(/^Bearer .+/)
    await provider.close('test')
  })

  test('the server is bound before ensureSession, not after', async () => {
    // If it bound after, the URL would be missing from session/new and the
    // agent would never learn the tools exist. acpx cannot add it later.
    reset()
    const provider = createAcpxProvider({
      agent: 'codex',
      sessionKey: 'k3',
      hostTools: { tools: { say: SAY } },
    })
    await provider.prepare()
    expect(captured.ensureSessionCalls).toHaveLength(1)
    const entries = captured.mcpAtSessionTime as HttpEntry[]
    expect(entries[0]?.url).toBeDefined()
    await provider.close('test')
  })

  test('a caller-configured server is kept alongside the host one', async () => {
    reset()
    const provider = createAcpxProvider({
      agent: 'codex',
      sessionKey: 'k4',
      mcpServers: [
        { type: 'http', name: 'search', url: 'http://example.test/mcp' },
      ],
      hostTools: { tools: { say: SAY } },
    })
    await provider.prepare()
    const names = (captured.mcpAtSessionTime as HttpEntry[]).map((s) => s.name)
    expect(names).toEqual(['search', 'host'])
    await provider.close('test')
  })

  test('serverName is honoured', async () => {
    reset()
    const provider = createAcpxProvider({
      agent: 'codex',
      sessionKey: 'k5',
      hostTools: { tools: { say: SAY }, serverName: 'herbie' },
    })
    await provider.prepare()
    const entries = captured.mcpAtSessionTime as HttpEntry[]
    expect(entries[0]?.name).toBe('herbie')
    await provider.close('test')
  })

  test('each session gets only its own server URL', async () => {
    // The resolver form exists for exactly this. An array would hand every
    // session every other session's URL and token.
    reset()
    const provider = createAcpxProvider({
      agent: 'codex',
      hostTools: { tools: { say: SAY } },
    })
    await provider.prepare({ sessionKey: 'a' })
    const first = (captured.mcpAtSessionTime as HttpEntry[])[0]?.url
    await provider.prepare({ sessionKey: 'b' })
    const second = (captured.mcpAtSessionTime as HttpEntry[])[0]?.url

    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(first).not.toBe(second)
    expect(captured.mcpAtSessionTime as HttpEntry[]).toHaveLength(1)
    await provider.close('test')
  })
})

describe('name collision', () => {
  test('a caller server of the same name is a loud failure', async () => {
    // Silently replacing the caller's server would break whatever it
    // pointed at; silently dropping ours would make hostTools do nothing.
    reset()
    const provider = createAcpxProvider({
      agent: 'codex',
      sessionKey: 'k6',
      mcpServers: [{ type: 'http', name: 'host', url: 'http://x.test/mcp' }],
      hostTools: { tools: { say: SAY } },
    })
    let message = ''
    try {
      await provider.prepare()
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('already contains a server named "host"')
    expect(message).toContain('hostTools.serverName')
  })

  test('renaming resolves the collision', async () => {
    reset()
    const provider = createAcpxProvider({
      agent: 'codex',
      sessionKey: 'k7',
      mcpServers: [{ type: 'http', name: 'host', url: 'http://x.test/mcp' }],
      hostTools: { tools: { say: SAY }, serverName: 'host-tools' },
    })
    await provider.prepare()
    const names = (captured.mcpAtSessionTime as HttpEntry[]).map((s) => s.name)
    expect(names).toEqual(['host', 'host-tools'])
    await provider.close('test')
  })
})

describe('teardown', () => {
  test('close releases the host tool port', async () => {
    reset()
    const provider = createAcpxProvider({
      agent: 'codex',
      sessionKey: 'k8',
      hostTools: { tools: { say: SAY } },
    })
    await provider.prepare()
    const url = (captured.mcpAtSessionTime as HttpEntry[])[0]?.url ?? ''
    expect(url).not.toBe('')

    await provider.close('test')

    let refused = false
    try {
      await fetch(url, { method: 'POST', body: '{}' })
    } catch {
      refused = true
    }
    expect(refused).toBe(true)
  })
})

describe('host tool identification', () => {
  test('a namespaced tool name is recognised as a host tool', async () => {
    // Each agent namespaces MCP tools differently, which is why consumers
    // get providerMetadata instead of being told to match a prefix.
    reset()
    const provider = createAcpxProvider({
      agent: 'codex',
      hostTools: { tools: { say: SAY } },
    })
    expect(provider.isHostTool('say')).toBe(true)
    expect(provider.isHostTool('mcp__host__say')).toBe(true)
    expect(provider.isHostTool('host__say')).toBe(true)
    expect(provider.isHostTool('read_file')).toBe(false)
    await provider.close('test')
  })

  test('nothing is a host tool when none are declared', async () => {
    const provider = createAcpxProvider({ agent: 'codex' })
    expect(provider.isHostTool('say')).toBe(false)
    expect(provider.hasHostTools()).toBe(false)
    await provider.close('test')
  })
})
