import { describe, expect, test } from 'bun:test'
import { stepCountIs, streamText } from 'ai'
import { createAcpxProvider } from '../../src/index.ts'
import { acpEvent, acpResult } from '../helpers/acp-event-builders.ts'
import { MockAcpRuntime } from '../helpers/mock-acp-runtime.ts'

describe('streamText — prepare() does not consume session freshness', () => {
  test('prepare() then streamText preserves multi-turn messages on first turn', async () => {
    const runtime = new MockAcpRuntime({
      turnScripts: [
        {
          events: [acpEvent.text('ok')],
          result: acpResult.completed('end_turn'),
        },
      ],
    })
    const provider = createAcpxProvider({
      agent: 'claude',
      sessionKey: 'fresh-prepare-1',
      runtime,
    })

    await provider.prepare()

    const result = streamText({
      model: provider.languageModel(),
      messages: [
        { role: 'user', content: 'What is the capital of France?' },
        { role: 'assistant', content: 'The capital of France is Paris.' },
        { role: 'user', content: 'What did you just tell me?' },
      ],
      stopWhen: stepCountIs(1),
    })
    await result.text

    const turnText = runtime.startTurnCalls[0]?.text ?? ''
    expect(turnText).toContain('What is the capital of France?')
    expect(turnText).toContain('The capital of France is Paris.')
    expect(turnText).toContain('What did you just tell me?')
  })

  test('second turn on the same session sends only the latest user message', async () => {
    const runtime = new MockAcpRuntime({
      turnScripts: [
        {
          events: [acpEvent.text('first')],
          result: acpResult.completed('end_turn'),
        },
        {
          events: [acpEvent.text('second')],
          result: acpResult.completed('end_turn'),
        },
      ],
    })
    const provider = createAcpxProvider({
      agent: 'claude',
      sessionKey: 'continuation-1',
      runtime,
    })

    const first = streamText({
      model: provider.languageModel(),
      messages: [{ role: 'user', content: 'hello first turn' }],
      stopWhen: stepCountIs(1),
    })
    await first.text

    const second = streamText({
      model: provider.languageModel(),
      messages: [
        { role: 'user', content: 'hello first turn' },
        { role: 'assistant', content: 'first' },
        { role: 'user', content: 'follow up message' },
      ],
      stopWhen: stepCountIs(1),
    })
    await second.text

    const secondTurnText = runtime.startTurnCalls[1]?.text ?? ''
    expect(secondTurnText).toContain('follow up message')
    expect(secondTurnText).not.toContain('hello first turn')
    expect(secondTurnText).not.toContain('first')
  })
})
