import { describe, expect, test } from 'bun:test'
import { MockAcpRuntime } from 'acpx-test-helpers'
import { createAcpxProvider } from '../../src/index.ts'

async function withHandle(runtime: MockAcpRuntime) {
  const provider = createAcpxProvider({
    agent: 'claude',
    cwd: '/tmp/t',
    sessionKey: 'controls',
    runtime,
  })
  await provider.prepare()
  return provider
}

describe('setModel', () => {
  test("uses the runtime's advertised model control", async () => {
    const runtime = new MockAcpRuntime()
    const provider = await withHandle(runtime)

    await provider.setModel('gpt-5-codex')

    expect(runtime.setModelCalls).toHaveLength(1)
    expect(runtime.setModelCalls[0]?.model).toBe('gpt-5-codex')
    // The config-option workaround must not fire when a real setter exists.
    expect(runtime.setConfigOptionCalls).toHaveLength(0)
  })

  test('falls back to the config option when the runtime has no setModel', async () => {
    const runtime = new MockAcpRuntime()
    // Older acpx had no setModel; drop it to reproduce that runtime.
    ;(runtime as { setModel?: unknown }).setModel = undefined
    const provider = await withHandle(runtime)

    await provider.setModel('gemini-2.5-pro')

    expect(runtime.setConfigOptionCalls).toHaveLength(1)
    expect(runtime.setConfigOptionCalls[0]).toMatchObject({
      key: 'model',
      value: 'gemini-2.5-pro',
    })
  })
})

describe('setModel on a fresh provider', () => {
  // The README's one-liner calls setModel without prepare(). Before the fix
  // that iterated an empty handle map and dropped the request silently.
  test('establishes a session rather than silently doing nothing', async () => {
    const runtime = new MockAcpRuntime()
    const provider = createAcpxProvider({
      agent: 'claude',
      cwd: '/tmp/t',
      sessionKey: 'fresh',
      runtime,
    })

    await provider.setModel('gpt-5-codex')

    expect(runtime.ensureSessionCalls.length).toBeGreaterThan(0)
    expect(runtime.setModelCalls).toHaveLength(1)
    expect(runtime.setModelCalls[0]?.model).toBe('gpt-5-codex')
  })

  test('the config-option fallback also gets a session', async () => {
    const runtime = new MockAcpRuntime()
    ;(runtime as { setModel?: unknown }).setModel = undefined
    const provider = createAcpxProvider({
      agent: 'claude',
      cwd: '/tmp/t',
      sessionKey: 'fresh-fallback',
      runtime,
    })

    await provider.setModel('gemini-2.5-pro')

    expect(runtime.setConfigOptionCalls).toHaveLength(1)
    expect(runtime.setConfigOptionCalls[0]).toMatchObject({
      key: 'model',
      value: 'gemini-2.5-pro',
    })
  })
})

describe('getCapabilities', () => {
  test('reads from the runtime without spawning a CLI', async () => {
    const runtime = new MockAcpRuntime()
    const provider = await withHandle(runtime)

    const caps = await provider.getCapabilities()

    expect(runtime.getCapabilitiesCalls).toHaveLength(1)
    expect(caps).toBeDefined()
  })

  test('answers for the requested session, not an arbitrary cached one', async () => {
    const runtime = new MockAcpRuntime()
    const provider = createAcpxProvider({
      agent: 'claude',
      cwd: '/tmp/t',
      runtime,
    })

    // Establish one session, then ask about a different one.
    await provider.prepare({ sessionKey: 'session-a' })
    runtime.getCapabilitiesCalls.length = 0
    await provider.getCapabilities({ sessionKey: 'session-b' })

    // Assert the positive: the handle must be session-b's, not merely
    // "not session-a", and not undefined (which asks for global capabilities).
    const asked = runtime.getCapabilitiesCalls[0]?.handle
    expect(asked?.sessionKey).toBe('session-b')
  })

  test('returns undefined when the runtime does not implement it', async () => {
    const runtime = new MockAcpRuntime()
    ;(runtime as { getCapabilities?: unknown }).getCapabilities = undefined
    const provider = await withHandle(runtime)

    expect(await provider.getCapabilities()).toBeUndefined()
  })
})

describe('seeding advertised commands from status', () => {
  test('seeds once for an agent that advertises an empty list', async () => {
    // acpx 0.21 reports commands on status rather than as an event. An agent
    // with none reports [], and caching that is what stops the seed re-running
    // getStatus on every ensureHandle.
    const runtime = new MockAcpRuntime({
      status: { summary: 'mock', availableCommands: [] },
    })
    const provider = createAcpxProvider({
      agent: 'claude',
      cwd: '/tmp/t',
      sessionKey: 'empty-cmds',
      runtime,
    })

    await provider.prepare()
    await provider.prepare()
    await provider.prepare()

    expect(runtime.getStatusCalls).toHaveLength(1)
    expect(provider.getAvailableCommands()).toEqual([])
  })

  test('seeds the list an agent does advertise', async () => {
    const runtime = new MockAcpRuntime({
      status: {
        summary: 'mock',
        availableCommands: [
          { name: 'status', description: 'Show status', hasInput: false },
          { name: 'compact', description: 'Compact context', hasInput: false },
        ],
      },
    })
    const provider = createAcpxProvider({
      agent: 'codex',
      cwd: '/tmp/t',
      sessionKey: 'seeded',
      runtime,
    })

    await provider.prepare()

    const names = provider.getAvailableCommands().map((c) => c.name)
    expect(names).toEqual(['status', 'compact'])
  })
})
