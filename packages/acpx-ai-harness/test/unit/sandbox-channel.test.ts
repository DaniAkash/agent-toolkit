import { describe, expect, test } from 'bun:test'
import type { HarnessV1NetworkSandboxSession } from '@ai-sdk/harness'
import {
  type AcpxChannel,
  createAcpxChannel,
  openAcpxChannel,
} from '../../src/sandbox-channel.ts'

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

/**
 * Lightweight stand-in for SandboxChannel that lets us drive the bridge-hello
 * race deterministically. Only models the surface `openAcpxChannel` uses.
 */
function makeFakeChannel() {
  const helloListeners: Array<() => void> = []
  let openResolve: (() => void) | undefined
  const openP = new Promise<void>((resolve) => {
    openResolve = resolve
  })
  let openCallArgs: { resume?: boolean } | undefined
  const channel = {
    open: (args?: { resume?: boolean }) => {
      openCallArgs = args
      return openP
    },
    on: (type: string, listener: () => void) => {
      if (type === 'bridge-hello') {
        helloListeners.push(listener)
        return () => {
          const idx = helloListeners.indexOf(listener)
          if (idx >= 0) helloListeners.splice(idx, 1)
        }
      }
      return () => {}
    },
    send: () => {},
    close: () => {},
    suspend: () => Promise.resolve(0),
    isClosed: () => false,
    beginClose: () => {},
    onClose: () => {},
  } as unknown as AcpxChannel
  return {
    channel,
    resolveOpen: () => openResolve?.(),
    fireBridgeHello: () => {
      for (const l of helloListeners) l()
    },
    getOpenCallArgs: () => openCallArgs,
  }
}

describe('openAcpxChannel', () => {
  test('resolves only after both channel.open() AND bridge-hello arrive', async () => {
    const fake = makeFakeChannel()
    let resolved = false
    const p = openAcpxChannel(fake.channel).then(() => {
      resolved = true
    })

    // Resolve open() first, but don't fire bridge-hello yet.
    fake.resolveOpen()
    await new Promise((r) => setTimeout(r, 10))
    expect(resolved).toBe(false)

    // Now fire bridge-hello; the promise should resolve.
    fake.fireBridgeHello()
    await p
    expect(resolved).toBe(true)
  })

  test('resolves when bridge-hello arrives before open() resolves', async () => {
    const fake = makeFakeChannel()
    // Fire bridge-hello pre-open. The SandboxChannel buffers messages
    // until a listener is registered, so we simulate that here by firing
    // AFTER the listener is attached (openAcpxChannel attaches it
    // synchronously before awaiting open).
    const p = openAcpxChannel(fake.channel)
    fake.fireBridgeHello()
    fake.resolveOpen()
    await p
  })

  test('rejects with a helpful error when bridge-hello never arrives', async () => {
    const fake = makeFakeChannel()
    fake.resolveOpen()
    // Don't fire bridge-hello; let the timeout kick in.
    await expect(
      openAcpxChannel(fake.channel, { helloTimeoutMs: 50 }),
    ).rejects.toThrow(/bridge did not send bridge-hello within 50ms/)
  })

  test('threads resume: true through to channel.open', async () => {
    const fake = makeFakeChannel()
    const p = openAcpxChannel(fake.channel, { resume: true })
    fake.resolveOpen()
    fake.fireBridgeHello()
    await p
    expect(fake.getOpenCallArgs()).toEqual({ resume: true })
  })

  test('does not pass any options to open when resume is false/undefined', async () => {
    const fake = makeFakeChannel()
    const p = openAcpxChannel(fake.channel)
    fake.resolveOpen()
    fake.fireBridgeHello()
    await p
    expect(fake.getOpenCallArgs()).toBeUndefined()
  })
})
