import { describe, expect, test } from 'bun:test'
import type { HarnessV1StreamPart } from '@ai-sdk/harness'
import { acpEvent, acpResult } from 'acpx-test-helpers'
import { AcpxEventTranslator } from '../../src/acpx-event-translator.ts'

function collect(
  agent: string,
  run: (t: AcpxEventTranslator) => void,
): HarnessV1StreamPart[] {
  const parts: HarnessV1StreamPart[] = []
  let nextId = 0
  const translator = new AcpxEventTranslator({
    agent,
    generateId: () => `id-${nextId++}`,
    emit: (part) => parts.push(part),
  })
  run(translator)
  return parts
}

describe('AcpxEventTranslator — stream-start', () => {
  test('emits a single stream-start when start() is called once', () => {
    const parts = collect('claude', (t) => t.start())
    expect(parts).toEqual([{ type: 'stream-start' }])
  })

  test('passes modelId through when provided', () => {
    const parts = collect('claude', (t) => t.start({ modelId: 'claude-3-7' }))
    expect(parts).toEqual([{ type: 'stream-start', modelId: 'claude-3-7' }])
  })

  test('is idempotent on repeated calls', () => {
    const parts = collect('claude', (t) => {
      t.start()
      t.start()
      t.start({ modelId: 'late' })
    })
    expect(parts).toEqual([{ type: 'stream-start' }])
  })
})

describe('AcpxEventTranslator — text deltas', () => {
  test('wraps a run of output deltas in a single text block', () => {
    const parts = collect('claude', (t) => {
      t.start()
      t.translate(acpEvent.text('hel'))
      t.translate(acpEvent.text('lo'))
      t.flush()
    })
    expect(parts).toEqual([
      { type: 'stream-start' },
      { type: 'text-start', id: 'id-0' },
      { type: 'text-delta', id: 'id-0', delta: 'hel' },
      { type: 'text-delta', id: 'id-0', delta: 'lo' },
      { type: 'text-end', id: 'id-0' },
    ])
  })

  test('thought deltas open a reasoning block', () => {
    const parts = collect('claude', (t) => {
      t.start()
      t.translate(acpEvent.thought('planning'))
      t.flush()
    })
    expect(parts.map((p) => p.type)).toEqual([
      'stream-start',
      'reasoning-start',
      'reasoning-delta',
      'reasoning-end',
    ])
  })

  test('switching from output to thought closes and reopens', () => {
    const parts = collect('claude', (t) => {
      t.start()
      t.translate(acpEvent.text('one'))
      t.translate(acpEvent.thought('two'))
      t.translate(acpEvent.text('three'))
      t.flush()
    })
    expect(parts.map((p) => p.type)).toEqual([
      'stream-start',
      'text-start',
      'text-delta',
      'text-end',
      'reasoning-start',
      'reasoning-delta',
      'reasoning-end',
      'text-start',
      'text-delta',
      'text-end',
    ])
  })

  test('empty deltas open the block but emit no delta part', () => {
    const parts = collect('claude', (t) => {
      t.start()
      t.translate(acpEvent.text(''))
      t.flush()
    })
    expect(parts.map((p) => p.type)).toEqual([
      'stream-start',
      'text-start',
      'text-end',
    ])
  })
})

describe('AcpxEventTranslator — tool calls', () => {
  test('completed tool emits tool-call then tool-result', () => {
    const parts = collect('claude', (t) => {
      t.start()
      t.translate(
        acpEvent.toolCall({
          toolCallId: 'c1',
          title: 'Bash',
          text: '{"command":"ls"}',
          status: 'completed',
        }),
      )
      t.flush()
    })
    expect(parts).toEqual([
      { type: 'stream-start' },
      {
        type: 'tool-call',
        toolCallId: 'c1',
        toolName: 'bash',
        input: '{"command":"ls"}',
        providerExecuted: true,
        nativeName: 'Bash',
      },
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'bash',
        result: '{"command":"ls"}',
      },
    ])
  })

  test('failed tool sets isError on the tool-result', () => {
    const parts = collect('codex', (t) => {
      t.start()
      t.translate(
        acpEvent.toolCall({
          toolCallId: 'c2',
          title: 'shell',
          text: 'boom',
          status: 'failed',
        }),
      )
      t.flush()
    })
    const result = parts.find((p) => p.type === 'tool-result')
    expect(result).toEqual({
      type: 'tool-result',
      toolCallId: 'c2',
      toolName: 'bash',
      result: 'boom',
      isError: true,
    })
  })

  test('unmapped agent passes the native tool name through unchanged', () => {
    const parts = collect('unknown', (t) => {
      t.start()
      t.translate(
        acpEvent.toolCall({
          toolCallId: 'c3',
          title: 'CustomTool',
          text: 'x',
          status: 'completed',
        }),
      )
    })
    const call = parts.find((p) => p.type === 'tool-call')
    expect(call).toMatchObject({ toolName: 'CustomTool' })
    expect(call).not.toHaveProperty('nativeName')
  })

  test('pending tool call without terminal status is finalised on flush', () => {
    const parts = collect('claude', (t) => {
      t.start()
      t.translate(
        acpEvent.toolCall({
          toolCallId: 'c4',
          title: 'Read',
          text: '{"file_path":"a"}',
          status: 'pending',
        }),
      )
      t.flush()
    })
    expect(parts.map((p) => p.type)).toEqual([
      'stream-start',
      'tool-call',
      'tool-result',
    ])
  })
})

describe('AcpxEventTranslator — status updates', () => {
  test('plan status emits a self-contained reasoning block', () => {
    const parts = collect('claude', (t) => {
      t.start()
      t.translate(acpEvent.status({ tag: 'plan', text: 'Refactor steps...' }))
    })
    expect(parts.map((p) => p.type)).toEqual([
      'stream-start',
      'reasoning-start',
      'reasoning-delta',
      'reasoning-end',
    ])
    const delta = parts.find((p) => p.type === 'reasoning-delta') as Extract<
      HarnessV1StreamPart,
      { type: 'reasoning-delta' }
    >
    expect(delta.delta).toBe('[Plan] Refactor steps...')
  })

  test('whitespace-only plans are skipped', () => {
    const parts = collect('claude', (t) => {
      t.start()
      t.translate(acpEvent.status({ tag: 'plan', text: '   ' }))
    })
    expect(parts.map((p) => p.type)).toEqual(['stream-start'])
  })

  test('usage_update accumulates into the final finish payload', () => {
    const parts = collect('claude', (t) => {
      t.start()
      t.translate(
        acpEvent.status({ tag: 'usage_update', used: 1000, size: 256 }),
      )
      t.flush()
      t.finish(acpResult.completed('end_turn'))
    })
    const finish = parts.find((p) => p.type === 'finish') as Extract<
      HarnessV1StreamPart,
      { type: 'finish' }
    >
    expect(finish.totalUsage.inputTokens.total).toBe(1000)
    expect(finish.totalUsage.inputTokens.cacheRead).toBe(256)
  })
})

describe('AcpxEventTranslator — finish', () => {
  test('clean completion maps stopReason to unified `stop`', () => {
    const parts = collect('claude', (t) => {
      t.start()
      t.flush()
      t.finish(acpResult.completed('end_turn'))
    })
    const finish = parts.find((p) => p.type === 'finish') as Extract<
      HarnessV1StreamPart,
      { type: 'finish' }
    >
    expect(finish.finishReason.unified).toBe('stop')
    expect(finish.finishReason.raw).toBe('end_turn')
  })

  test('tool_calls stopReason maps to unified `tool-calls`', () => {
    const parts = collect('claude', (t) => {
      t.start()
      t.flush()
      t.finish(acpResult.completed('tool_calls'))
    })
    const finish = parts.find((p) => p.type === 'finish') as Extract<
      HarnessV1StreamPart,
      { type: 'finish' }
    >
    expect(finish.finishReason.unified).toBe('tool-calls')
  })

  test('failure emits an error part before finish, finishReason `error`', () => {
    const parts = collect('claude', (t) => {
      t.start()
      t.flush()
      t.finish(acpResult.failed({ message: 'auth', code: 'unauthenticated' }))
    })
    const types = parts.map((p) => p.type)
    expect(types.indexOf('error')).toBeLessThan(types.indexOf('finish'))
    const finish = parts.find((p) => p.type === 'finish') as Extract<
      HarnessV1StreamPart,
      { type: 'finish' }
    >
    expect(finish.finishReason.unified).toBe('error')
  })

  test('runtime error event surfaces as an error stream part', () => {
    const parts = collect('claude', (t) => {
      t.start()
      t.translate(acpEvent.error('transient', { code: 'flaky' }))
    })
    expect(parts.find((p) => p.type === 'error')).toBeDefined()
  })
})
