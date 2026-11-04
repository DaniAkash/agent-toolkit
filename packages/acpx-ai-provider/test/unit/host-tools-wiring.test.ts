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
  /** Every resolution, in order, so a leaked second listener is visible. */
  allMcp: unknown[]
}

const captured: Captured = {
  options: undefined,
  ensureSessionCalls: [],
  mcpAtSessionTime: undefined,
  allMcp: [],
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
      captured.allMcp.push(captured.mcpAtSessionTime)
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
  captured.allMcp = []
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
  test('a namespaced tool name is recognised, in any separator style', async () => {
    // Each agent namespaces MCP tools differently, which is why consumers
    // get providerMetadata instead of being told to match a prefix.
    const provider = createAcpxProvider({
      agent: 'codex',
      hostTools: { tools: { say: SAY } },
    })
    for (const name of [
      'mcp__host__say',
      'host__say',
      // Verbatim from a codex run: it namespaces with DOTS.
      'mcp.host.say',
      'host.say',
      'host/say',
    ]) {
      expect(provider.isHostTool('s1', name)).toBe(true)
    }
    expect(provider.isHostTool('s1', 'read_file')).toBe(false)
    // Anchored on the server name, so an agent tool whose name merely ends
    // in a host tool's name is not swept up.
    expect(provider.isHostTool('s1', 'agent_say')).toBe(false)
    expect(provider.isHostTool('s1', 'other__say')).toBe(false)
    await provider.close('test')
  })

  test('a BARE name is only ours once this session served it', async () => {
    // Reported in review: the bare fast path accepted an unnamespaced name
    // without proving it came from our server, so an agent's own tool
    // called `say` was marked `hostTool: true`. Shape cannot tell them
    // apart, so the answer comes from what the server actually served.
    reset()
    const provider = createAcpxProvider({
      agent: 'codex',
      sessionKey: 'bare',
      hostTools: { tools: { say: SAY } },
    })
    await provider.prepare()

    // Nothing served yet: a bare `say` is not credited to us.
    expect(provider.isHostTool('bare', 'say')).toBe(false)

    // Drive a real call through the bound server, which is what records it.
    const entry = (captured.mcpAtSessionTime as HttpEntry[])[0]
    const res = await fetch(entry?.url ?? '', {
      method: 'POST',
      headers: {
        authorization: entry?.headers?.[0]?.value ?? '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'say', arguments: { text: 'hi' } },
      }),
    })
    expect(res.status).toBe(200)

    // Now it is, and only for the session that served it.
    expect(provider.isHostTool('bare', 'say')).toBe(true)
    expect(provider.isHostTool('other-session', 'say')).toBe(false)
    await provider.close('test')
  })

  test('nothing is a host tool when none are declared', async () => {
    const provider = createAcpxProvider({ agent: 'codex' })
    expect(provider.isHostTool('s1', 'say')).toBe(false)
    expect(provider.hasHostTools()).toBe(false)
    await provider.close('test')
  })
})

describe('an injected runtime cannot register host tools', () => {
  test('it is reported rather than left silent', async () => {
    // Reported in review. `mcpServers` is set when the runtime is built,
    // so a pre-built runtime never receives the resolver and the agent
    // never learns the tools exist.
    const provider = createAcpxProvider({
      agent: 'codex',
      runtime: {
        ensureSession: async () => ({}),
        startTurn: () => ({
          requestId: 'r',
          events: { [Symbol.asyncIterator]: async function* () {} },
          result: Promise.resolve({ status: 'completed' }),
          cancel: async () => {},
          closeStream: async () => {},
        }),
        cancel: async () => {},
        close: async () => {},
      } as unknown as AcpRuntime,
      hostTools: { tools: { say: SAY } },
    })
    expect(provider.hostToolsUnregisterable()).toBe(true)
    await provider.close('test')
  })

  test('a provider that builds its own runtime is registerable', async () => {
    const provider = createAcpxProvider({
      agent: 'codex',
      hostTools: { tools: { say: SAY } },
    })
    expect(provider.hostToolsUnregisterable()).toBe(false)
    await provider.close('test')
  })
})

describe('concurrent turns on one session', () => {
  test("one turn ending does not cancel another turn's pending call", async () => {
    // Reported in review: the controller was keyed by session, so a second
    // beginTurn overwrote the first and the first stream's completion
    // aborted the SECOND turn's pending call.
    //
    // Observed through a real call rather than through the private map: a
    // pending `execute` holds the signal it was handed, which is the thing
    // that actually broke.
    reset()
    let held: AbortSignal | undefined
    let release: (() => void) | undefined
    const waiting: AcpxHostTool = {
      description: 'Wait until the host lets go.',
      inputSchema: { type: 'object', properties: {} },
      execute: (_input, context) => {
        held = context.abortSignal
        return new Promise<string>((resolve) => {
          release = () => resolve('done')
        })
      },
    }
    const provider = createAcpxProvider({
      agent: 'codex',
      sessionKey: 'turns',
      hostTools: { tools: { wait: waiting } },
    })
    await provider.prepare()
    const entry = (captured.mcpAtSessionTime as HttpEntry[])[0]

    const first = provider.beginTurn('turns')
    const second = provider.beginTurn('turns')
    expect(first).not.toBe(second)

    // A call arriving now belongs to the newest live turn.
    const inFlight = fetch(entry?.url ?? '', {
      method: 'POST',
      headers: {
        authorization: entry?.headers?.[0]?.value ?? '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'wait', arguments: {} },
      }),
    })
    while (!held) await new Promise((r) => setTimeout(r, 5))

    provider.endTurn('turns', first)
    expect(held?.aborted).toBe(false)

    provider.endTurn('turns', second)
    expect(held?.aborted).toBe(true)

    release?.()
    await inFlight
    await provider.close('test')
  })

  test('a call arriving with no live turn gets an aborted signal', async () => {
    // Honest rather than convenient: there is nothing for it to wait on.
    reset()
    let seen: boolean | undefined
    const provider = createAcpxProvider({
      agent: 'codex',
      sessionKey: 'noturn',
      hostTools: {
        tools: {
          peek: {
            description: 'Report whether the signal was already aborted.',
            inputSchema: { type: 'object', properties: {} },
            execute: (_i, context) => {
              seen = context.abortSignal.aborted
              return 'ok'
            },
          },
        },
      },
    })
    await provider.prepare()
    const entry = (captured.mcpAtSessionTime as HttpEntry[])[0]
    await fetch(entry?.url ?? '', {
      method: 'POST',
      headers: {
        authorization: entry?.headers?.[0]?.value ?? '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'peek', arguments: {} },
      }),
    })
    expect(seen).toBe(true)
    await provider.close('test')
  })
})

describe('close with a call still pending', () => {
  test('close aborts the pending call and does not hang', async () => {
    // Reported in review, and the worst of the set: close() awaited
    // server.close() and never aborted the controllers. A host tool
    // waiting on a human keeps its tools/call active, and a listener that
    // waits for active requests then never finishes closing, so
    // provider.close() hung forever on exactly the case this feature is
    // for.
    reset()
    let held: AbortSignal | undefined
    const waiting: AcpxHostTool = {
      description: 'Wait for the human, i.e. never resolve on its own.',
      inputSchema: { type: 'object', properties: {} },
      execute: (_input, context) =>
        new Promise<string>((resolve) => {
          held = context.abortSignal
          context.abortSignal.addEventListener(
            'abort',
            () => resolve('aborted'),
            { once: true },
          )
        }),
    }
    const provider = createAcpxProvider({
      agent: 'codex',
      sessionKey: 'hang',
      hostTools: { tools: { ask: waiting } },
    })
    await provider.prepare()
    provider.beginTurn('hang')
    const entry = (captured.mcpAtSessionTime as HttpEntry[])[0]

    const inFlight = fetch(entry?.url ?? '', {
      method: 'POST',
      headers: {
        authorization: entry?.headers?.[0]?.value ?? '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'ask', arguments: {} },
      }),
    })
    while (!held) await new Promise((r) => setTimeout(r, 5))
    expect(held?.aborted).toBe(false)

    // The assertion is that this resolves at all. Bounded so a regression
    // fails the test instead of hanging the suite.
    const closed = await Promise.race([
      provider.close('test').then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('HUNG'), 3000)),
    ])
    expect(closed).toBe('closed')
    expect(held?.aborted).toBe(true)
    await inFlight.catch(() => undefined)
  }, 10_000)
})

describe('starting the server concurrently', () => {
  test('concurrent first turns end up with one server, one URL', async () => {
    // Reported in review: `has` then `await` let several callers through,
    // so more than one listener bound and the map kept only the last,
    // orphaning the earlier ports.
    //
    // Honest about what this proves. It asserts the end state: one host
    // entry per resolution and one URL across all of them. It does NOT
    // detect the transient extra binds, which were checked by removing
    // both the in-flight lock and the loser-cleanup and watching this
    // still pass: an orphaned listener is not observable through the
    // provider's public surface. The lock and the cleanup are correct by
    // construction rather than by this test, and the cleanup is the one
    // that prevents an actual leak.
    reset()
    const provider = createAcpxProvider({
      agent: 'codex',
      sessionKey: 'race',
      hostTools: { tools: { say: SAY } },
    })
    await Promise.all([
      provider.prepare(),
      provider.prepare(),
      provider.prepare(),
    ])

    // Asserted across EVERY resolution, not just the last. The last one
    // alone cannot see a leak: the map keeps whichever server won, so a
    // check of the final state passes while an earlier listener is still
    // bound and orphaned. Distinct URLs are the evidence of a second bind.
    const urls = new Set(
      (captured.allMcp as HttpEntry[][]).flatMap((entries) =>
        entries.filter((e) => e.name === 'host').map((e) => e.url ?? ''),
      ),
    )
    expect(urls.size).toBe(1)
    for (const entries of captured.allMcp as HttpEntry[][]) {
      expect(entries.filter((e) => e.name === 'host')).toHaveLength(1)
    }
    await provider.close('test')
  })
})
