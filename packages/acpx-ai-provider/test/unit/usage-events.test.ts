import { describe, expect, test } from 'bun:test'
import { createAcpxProvider } from '../../src/index.ts'
import { acpEvent, acpResult } from '../helpers/acp-event-builders.ts'
import { MockAcpRuntime } from '../helpers/mock-acp-runtime.ts'

const userPrompt = [
  { role: 'user', content: [{ type: 'text', text: 'hi' }] },
] as const

describe('AcpxProvider — usage event subscription', () => {
  test('emits usage events on provider.events.on("usage") with cost + breakdown', async () => {
    const runtime = new MockAcpRuntime({
      turnScripts: [
        {
          events: [
            acpEvent.text('hi'),
            acpEvent.usage(1200, 200_000, {
              cost: { amount: 0.0123, currency: 'USD' },
              breakdown: {
                inputTokens: 800,
                outputTokens: 400,
                cachedReadTokens: 600,
                cachedWriteTokens: 50,
                thoughtTokens: 75,
                totalTokens: 1925,
              },
            }),
          ],
          result: acpResult.completed('end_turn'),
        },
      ],
    })
    const provider = createAcpxProvider({
      agent: 'claude',
      cwd: '/tmp/test',
      sessionKey: 'test-session',
      runtime,
    })

    const observed: unknown[] = []
    provider.events.on('usage', (snapshot) => observed.push(snapshot))

    const { stream } = await provider.languageModel().doStream({
      prompt: userPrompt as never,
    })
    const reader = stream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    expect(observed).toHaveLength(1)
    const snapshot = observed[0] as Record<string, unknown>
    expect(snapshot.used).toBe(1200)
    expect(snapshot.size).toBe(200_000)
    expect(snapshot.cost).toEqual({ amount: 0.0123, currency: 'USD' })
    expect(snapshot.breakdown).toMatchObject({
      inputTokens: 800,
      outputTokens: 400,
      cachedReadTokens: 600,
      cachedWriteTokens: 50,
      thoughtTokens: 75,
      totalTokens: 1925,
    })
    expect(snapshot.sessionKey).toBe('test-session')
    expect(typeof snapshot.at).toBe('number')
  })

  test('provider.getUsage() returns the most recent snapshot synchronously', async () => {
    const runtime = new MockAcpRuntime({
      turnScripts: [
        {
          events: [
            acpEvent.usage(50, 1000),
            acpEvent.usage(75, 1000),
            acpEvent.usage(100, 1000),
          ],
          result: acpResult.completed('end_turn'),
        },
      ],
    })
    const provider = createAcpxProvider({
      agent: 'claude',
      cwd: '/tmp/test',
      sessionKey: 'test-session',
      runtime,
    })

    expect(provider.getUsage('test-session')).toBeUndefined()

    const { stream } = await provider.languageModel().doStream({
      prompt: userPrompt as never,
    })
    const reader = stream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    const snapshot = provider.getUsage('test-session')
    expect(snapshot?.used).toBe(100)
    expect(snapshot?.size).toBe(1000)
  })
})

describe('AcpxProvider — available commands event subscription', () => {
  test('emits availableCommands events with the full structured list', async () => {
    const runtime = new MockAcpRuntime({
      turnScripts: [
        {
          events: [
            acpEvent.availableCommands([
              {
                name: '/compact',
                description: 'Compact context',
                hasInput: false,
              },
              { name: '/clear', hasInput: false },
              { name: '/cost', description: 'Show cost', hasInput: false },
            ]),
            acpEvent.text('done'),
          ],
          result: acpResult.completed('end_turn'),
        },
      ],
    })
    const provider = createAcpxProvider({
      agent: 'claude',
      cwd: '/tmp/test',
      sessionKey: 'test-session',
      runtime,
    })

    const observed: unknown[] = []
    provider.events.on('availableCommands', (payload) => observed.push(payload))

    const { stream } = await provider.languageModel().doStream({
      prompt: userPrompt as never,
    })
    const reader = stream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    expect(observed).toHaveLength(1)
    const event = observed[0] as { sessionKey: string; commands: unknown[] }
    expect(event.sessionKey).toBe('test-session')
    expect(event.commands).toHaveLength(3)
    expect(provider.getAvailableCommands('test-session')).toHaveLength(3)
  })
})

describe('AcpxProvider — runSlashCommand', () => {
  test('starts a turn with the slash name as text and drains the iterator', async () => {
    const runtime = new MockAcpRuntime({
      turnScripts: [
        {
          events: [],
          result: acpResult.completed('end_turn'),
        },
      ],
    })
    const provider = createAcpxProvider({
      agent: 'claude',
      cwd: '/tmp/test',
      sessionKey: 'test-session',
      runtime,
    })

    await provider.runSlashCommand({ name: '/compact' })
    const call = runtime.startTurnCalls.at(-1)
    expect(call?.text).toBe('/compact')
  })

  test('throws an AcpxError-ish error if the slash command turn fails', async () => {
    const runtime = new MockAcpRuntime({
      turnScripts: [
        {
          events: [],
          result: acpResult.failed({ message: 'no such command' }),
        },
      ],
    })
    const provider = createAcpxProvider({
      agent: 'claude',
      cwd: '/tmp/test',
      sessionKey: 'test-session',
      runtime,
    })

    await expect(provider.runSlashCommand({ name: '/bogus' })).rejects.toThrow(
      /slash command "\/bogus" failed: no such command/,
    )
  })
})

describe('AcpxProvider — compact', () => {
  test('throws when no compact command has been advertised', async () => {
    const runtime = new MockAcpRuntime()
    const provider = createAcpxProvider({
      agent: 'claude',
      cwd: '/tmp/test',
      sessionKey: 'test-session',
      runtime,
    })

    await expect(provider.compact()).rejects.toThrow(
      /does not advertise a compact command/,
    )
  })

  test('sends the advertised compact name as a slash-command turn', async () => {
    const runtime = new MockAcpRuntime({
      turnScripts: [
        {
          events: [
            acpEvent.availableCommands([
              {
                name: '/compact',
                description: 'Compact context',
                hasInput: false,
              },
            ]),
          ],
          result: acpResult.completed('end_turn'),
        },
        {
          events: [],
          result: acpResult.completed('end_turn'),
        },
      ],
    })
    const provider = createAcpxProvider({
      agent: 'claude',
      cwd: '/tmp/test',
      sessionKey: 'test-session',
      runtime,
    })

    // First turn: any prompt; surfaces the availableCommands list to the
    // provider via the event subscription.
    const { stream } = await provider.languageModel().doStream({
      prompt: userPrompt as never,
    })
    const reader = stream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    await provider.compact()
    expect(runtime.startTurnCalls.at(-1)?.text).toBe('/compact')
  })
})
