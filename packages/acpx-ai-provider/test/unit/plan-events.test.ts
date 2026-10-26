import { describe, expect, test } from 'bun:test'
import { acpEvent, acpResult, MockAcpRuntime } from 'acpx-test-helpers'
import { createAcpxProvider } from '../../src/index.ts'

const userPrompt = [
  { role: 'user', content: [{ type: 'text', text: 'hi' }] },
] as const

async function drain(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const parts: unknown[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return parts
}

function providerWith(events: ReturnType<typeof acpEvent.plan>[]) {
  const runtime = new MockAcpRuntime({
    turnScripts: [{ events, result: acpResult.completed('end_turn') }],
  })
  // No sessionKey, so the key is derived from the agent, matching how a
  // caller that never passes one behaves.
  const provider = createAcpxProvider({
    agent: 'claude',
    cwd: '/tmp/t',
    runtime,
  })
  return { runtime, provider }
}

describe('structured plan events', () => {
  test('emits the entries on provider.events and getPlan', async () => {
    const entries = [
      { content: 'Read the file', status: 'completed' as const },
      {
        content: 'Patch it',
        status: 'in_progress' as const,
        priority: 'high' as const,
      },
      { content: 'Run tests', status: 'pending' as const },
    ]
    const { provider } = providerWith([acpEvent.planEntries(entries)])

    const seen: { sessionKey: string; entries: unknown[] }[] = []
    provider.events.on('plan', (snapshot) => seen.push(snapshot))

    const { stream } = await provider.languageModel().doStream({
      prompt: userPrompt as never,
    })
    await drain(stream)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.entries).toEqual(entries)
    expect(provider.getPlan()).toEqual(entries)
  })

  test('renders the entries into the reasoning stream with status marks', async () => {
    const { provider } = providerWith([
      acpEvent.planEntries([
        { content: 'Done thing', status: 'completed' },
        { content: 'Doing thing', status: 'in_progress', priority: 'low' },
        { content: 'Later thing', status: 'pending' },
      ]),
    ])

    const { stream } = await provider.languageModel().doStream({
      prompt: userPrompt as never,
    })
    const parts = (await drain(stream)) as { type: string; delta?: string }[]
    const delta = parts.find((p) => p.type === 'reasoning-delta')?.delta ?? ''

    expect(delta).toContain('[x] Done thing')
    expect(delta).toContain('[~] Doing thing (low)')
    expect(delta).toContain('[ ] Later thing')
  })

  // The regression this file exists for. An empty snapshot is acpx's clear
  // signal; the previous handler returned early on it, so a stale plan
  // survived forever.
  test('an empty snapshot clears the stored plan', async () => {
    const runtime = new MockAcpRuntime({
      turnScripts: [
        {
          events: [
            acpEvent.planEntries([{ content: 'Step one', status: 'pending' }]),
          ],
          result: acpResult.completed('end_turn'),
        },
        {
          events: [acpEvent.planEntries([])],
          result: acpResult.completed('end_turn'),
        },
      ],
    })
    const provider = createAcpxProvider({
      agent: 'claude',
      cwd: '/tmp/t',
      runtime,
    })

    const seen: unknown[][] = []
    provider.events.on('plan', (s) => seen.push(s.entries))

    const first = await provider
      .languageModel()
      .doStream({ prompt: userPrompt as never })
    await drain(first.stream)
    expect(provider.getPlan()).toHaveLength(1)

    const second = await provider
      .languageModel()
      .doStream({ prompt: userPrompt as never })
    await drain(second.stream)

    expect(provider.getPlan()).toEqual([])
    expect(seen).toEqual([[{ content: 'Step one', status: 'pending' }], []])
  })

  test('getPlan returns a defensive copy', async () => {
    const { provider } = providerWith([
      acpEvent.planEntries([{ content: 'Original', status: 'pending' }]),
    ])
    const { stream } = await provider.languageModel().doStream({
      prompt: userPrompt as never,
    })
    await drain(stream)

    const snapshot = provider.getPlan()
    const first = snapshot[0]
    expect(first).toBeDefined()
    if (first) first.content = 'Mutated'
    expect(provider.getPlan()[0]?.content).toBe('Original')
  })

  test('a prose plan with no entries still reaches the reasoning stream', async () => {
    const { provider } = providerWith([acpEvent.plan('Do the thing')])
    const seen: unknown[] = []
    provider.events.on('plan', (s) => seen.push(s))

    const { stream } = await provider.languageModel().doStream({
      prompt: userPrompt as never,
    })
    const parts = (await drain(stream)) as { type: string; delta?: string }[]

    expect(parts.find((p) => p.type === 'reasoning-delta')?.delta).toBe(
      '[Plan] Do the thing',
    )
    // No structured entries to report, so the event channel stays quiet
    // rather than inventing a shape.
    expect(seen).toHaveLength(0)
  })
})
