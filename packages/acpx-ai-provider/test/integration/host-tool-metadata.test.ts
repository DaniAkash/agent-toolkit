/**
 * The `providerMetadata` marker on a host tool's `tool-call` part, asserted
 * on the raw stream.
 *
 * On the stream deliberately, not through `generateText().steps`: the AI
 * SDK reshapes a call for a tool it was not given into a dynamic, invalid
 * one carrying `AI_NoSuchToolError`, and `providerMetadata` does not
 * survive that. The provider's contract is the stream part, which is what
 * a consumer rendering a tool timeline actually reads.
 *
 * The names here are the ones agents really emit. `mcp.host.store_value`
 * is copied from a codex run: it namespaces with DOTS, and the first
 * version of this matcher only handled `__`, so the marker silently never
 * fired on the one agent the feature was built against.
 */
import { describe, expect, test } from 'bun:test'
import type {
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider'
import {
  acpEvent,
  acpResult,
  convertReadableStreamToArray,
  MockAcpRuntime,
} from 'acpx-test-helpers'
import type { AcpxHostTool } from '../../src/index.ts'
import { createAcpxProvider } from '../../src/index.ts'

const STORE: AcpxHostTool = {
  description: 'Store a value in the host.',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  },
  execute: () => 'stored',
}

const call: LanguageModelV2CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
}

async function toolCallPart(
  reportedToolName: string,
  hostTools?: Record<string, AcpxHostTool>,
): Promise<LanguageModelV2StreamPart | undefined> {
  const runtime = new MockAcpRuntime({
    turnScripts: [
      {
        events: [
          acpEvent.toolCall({
            toolCallId: 'c1',
            title: reportedToolName,
            text: '{"value":"hello"}',
            status: 'completed',
          }),
        ],
        result: acpResult.completed('tool_calls'),
      },
    ],
  })
  const provider = createAcpxProvider({
    agent: 'claude',
    runtime,
    ...(hostTools ? { hostTools: { tools: hostTools } } : {}),
  })
  const { stream } = await provider.languageModel().doStream(call)
  const parts = await convertReadableStreamToArray(stream)
  return parts.find((p) => p.type === 'tool-call')
}

function metaOf(part: LanguageModelV2StreamPart | undefined): unknown {
  return part && part.type === 'tool-call' ? part.providerMetadata : undefined
}

describe('host tool marking on the stream', () => {
  test('a bare host tool name is NOT marked on shape alone', async () => {
    // Changed deliberately in review. A bare name cannot be told apart
    // from an agent's own tool of the same name by shape, so it is only
    // credited to us when the session actually served a call by that name
    // (see the `onCall` test in test/unit/host-tools-wiring.test.ts).
    // Here nothing was served, so it stays unmarked.
    const part = await toolCallPart('store_value', { store_value: STORE })
    expect(metaOf(part)).toBeUndefined()
  })

  test('the dotted form codex emits is marked', async () => {
    // Regression: `mcp.host.store_value` is verbatim from a codex run.
    const part = await toolCallPart('mcp.host.store_value', {
      store_value: STORE,
    })
    expect(metaOf(part)).toMatchObject({ acpx: { hostTool: true } })
  })

  test('the underscored forms are marked', async () => {
    for (const name of ['mcp__host__store_value', 'host__store_value']) {
      const part = await toolCallPart(name, { store_value: STORE })
      expect(metaOf(part)).toMatchObject({ acpx: { hostTool: true } })
    }
  })

  test("an agent's own tool sharing a host tool's bare name is not marked", async () => {
    // The false positive this change removes: previously `say` from the
    // agent's own toolset was reported as ours.
    const part = await toolCallPart('store_value', { store_value: STORE })
    expect(metaOf(part)).toBeUndefined()
  })

  test("an agent's own tool is not marked", async () => {
    const part = await toolCallPart('read_file', { store_value: STORE })
    expect(metaOf(part)).toBeUndefined()
  })

  test('a name that merely ends in a host tool name is not marked', async () => {
    // Anchored on the server name, so a bare suffix check cannot sweep up
    // an agent tool whose name happens to end the same way.
    const part = await toolCallPart('agent_store_value', {
      store_value: STORE,
    })
    expect(metaOf(part)).toBeUndefined()
  })

  test('nothing is marked when no host tools are declared', async () => {
    const part = await toolCallPart('store_value')
    expect(metaOf(part)).toBeUndefined()
  })

  test('the part is still emitted and still provider-executed', async () => {
    // Suppressing it would lie about what the agent did and break any
    // consumer rendering a tool timeline.
    const part = await toolCallPart('mcp.host.store_value', {
      store_value: STORE,
    })
    expect(part).toBeDefined()
    if (part?.type === 'tool-call') {
      expect(part.providerExecuted).toBe(true)
      expect(part.toolName).toBe('mcp.host.store_value')
    }
  })
})
