import { describe, expect, test } from 'bun:test'
import type { AcpRuntime } from 'acpx/runtime'
import { MockAcpRuntime } from 'acpx-test-helpers'
import { createAcpxProvider } from '../../src/provider.ts'

describe('AcpxProvider — getModels', () => {
  test('returns the models field from runtime status', async () => {
    const runtime = new MockAcpRuntime({
      status: {
        summary: 'mock',
        models: {
          currentModelId: 'claude-opus-4-7',
          availableModelIds: [
            'claude-haiku-4-5',
            'claude-sonnet-4-6',
            'claude-opus-4-7',
          ],
        },
      },
    })
    const provider = createAcpxProvider({ agent: 'claude', runtime })

    const models = await provider.getModels()

    expect(models).toEqual({
      currentModelId: 'claude-opus-4-7',
      availableModelIds: [
        'claude-haiku-4-5',
        'claude-sonnet-4-6',
        'claude-opus-4-7',
      ],
    })
    // Two calls, not one: establishing the session seeds the advertised
    // command list from status, since acpx 0.21 no longer streams it as an
    // event, and getModels then reads status for itself. The seed happens
    // once per session key.
    expect(runtime.getStatusCalls).toHaveLength(2)
  })

  test('returns undefined when the runtime status omits models', async () => {
    const runtime = new MockAcpRuntime({ status: { summary: 'no models' } })
    const provider = createAcpxProvider({ agent: 'gemini', runtime })

    const models = await provider.getModels()

    expect(models).toBeUndefined()
    // Two calls, not one: establishing the session seeds the advertised
    // command list from status, since acpx 0.21 no longer streams it as an
    // event, and getModels then reads status for itself. The seed happens
    // once per session key.
    expect(runtime.getStatusCalls).toHaveLength(2)
  })

  test('returns undefined when the runtime has no getStatus method', async () => {
    const runtime: AcpRuntime = {
      ensureSession: async () => ({
        sessionKey: 'k',
        backend: 'mock',
        runtimeSessionName: 'mock',
      }),
      startTurn: () => {
        throw new Error('not used')
      },
      runTurn: async function* () {
        // unused
      },
      cancel: async () => {},
      close: async () => {},
    }
    const provider = createAcpxProvider({ agent: 'custom', runtime })

    const models = await provider.getModels()

    expect(models).toBeUndefined()
  })
})
