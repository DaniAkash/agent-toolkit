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

describe('getCapabilities', () => {
  test('reads from the runtime without spawning a CLI', async () => {
    const runtime = new MockAcpRuntime()
    const provider = await withHandle(runtime)

    const caps = await provider.getCapabilities()

    expect(runtime.getCapabilitiesCalls).toHaveLength(1)
    expect(caps).toBeDefined()
  })

  test('returns undefined when the runtime does not implement it', async () => {
    const runtime = new MockAcpRuntime()
    ;(runtime as { getCapabilities?: unknown }).getCapabilities = undefined
    const provider = await withHandle(runtime)

    expect(await provider.getCapabilities()).toBeUndefined()
  })
})
