import { describe, expect, test } from 'bun:test'
import type { HarnessV1NetworkSandboxSession } from '@ai-sdk/harness'
import { createAcpxChannel } from '../../src/sandbox-channel.ts'

function makeFakeSandboxSession(
  getPortUrl: (opts: {
    port: number
    protocol?: 'ws' | 'http' | 'https'
  }) => Promise<string>,
): HarnessV1NetworkSandboxSession {
  return {
    id: 'sbx-1',
    defaultWorkingDirectory: '/sandbox',
    ports: [4001],
    getPortUrl,
    stop: async () => {},
    restricted: () => ({}) as never,
  } as unknown as HarnessV1NetworkSandboxSession
}

describe('createAcpxChannel', () => {
  test('returns a SandboxChannel-shaped object with the expected surface', () => {
    const sandboxSession = makeFakeSandboxSession(
      async () => 'ws://localhost:4001',
    )
    const channel = createAcpxChannel({
      sandboxSession,
      port: 4001,
      token: 'tok',
    })
    expect(typeof channel.open).toBe('function')
    expect(typeof channel.close).toBe('function')
    expect(typeof channel.send).toBe('function')
    expect(typeof channel.on).toBe('function')
    expect(typeof channel.suspend).toBe('function')
  })

  test('accepts initialLastSeenEventId for cross-process resume', () => {
    const sandboxSession = makeFakeSandboxSession(
      async () => 'ws://localhost:4001',
    )
    const channel = createAcpxChannel({
      sandboxSession,
      port: 4001,
      token: 'tok',
      initialLastSeenEventId: 42,
    })
    expect(typeof channel.open).toBe('function')
  })

  test('passes the configured port through to getPortUrl', async () => {
    const seenPorts: number[] = []
    const sandboxSession = makeFakeSandboxSession(async (opts) => {
      seenPorts.push(opts.port)
      return `ws://localhost:${opts.port}`
    })
    const channel = createAcpxChannel({
      sandboxSession,
      port: 5050,
      token: 'tok',
    })
    // Trigger a connection attempt to exercise the connect thunk. We expect
    // it to fail (no real WS server) but to have called getPortUrl first.
    try {
      await channel.open()
    } catch {
      // expected: no real ws server listening
    }
    expect(seenPorts).toContain(5050)
  })
})
