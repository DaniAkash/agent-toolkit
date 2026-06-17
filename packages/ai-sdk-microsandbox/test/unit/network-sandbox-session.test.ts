import { describe, expect, test } from 'bun:test'
import type { Sandbox } from 'microsandbox'
import {
  DEFAULT_WORKING_DIRECTORY,
  MicrosandboxNetworkSandboxSession,
} from '../../src/microsandbox-network-sandbox-session.ts'
import { MicrosandboxSandboxSession } from '../../src/microsandbox-sandbox-session.ts'
import { MockSandbox } from '../helpers/mock-sandbox.ts'

async function newSession(input: {
  mock?: MockSandbox
  ports?: Array<{ port: number; bind: string }>
  publicHostname?: string
  ownsLifecycle?: boolean
}): Promise<MicrosandboxNetworkSandboxSession> {
  const mock = input.mock ?? new MockSandbox()
  return MicrosandboxNetworkSandboxSession.create({
    sandbox: mock as unknown as Sandbox,
    ports: input.ports ?? [{ port: 8080, bind: '127.0.0.1' }],
    publicHostname: input.publicHostname,
    ownsLifecycle: input.ownsLifecycle ?? true,
  })
}

describe('MicrosandboxNetworkSandboxSession — identity', () => {
  test('id returns the sandbox name', async () => {
    const mock = new MockSandbox({ name: 'my-vm' })
    const session = await newSession({ mock })
    expect(session.id).toBe('my-vm')
  })
})

describe('MicrosandboxNetworkSandboxSession — defaultWorkingDirectory', () => {
  test('reflects sandbox.config().workdir when set', async () => {
    const mock = new MockSandbox({ config: { workdir: '/workspace' } })
    const session = await newSession({ mock })
    expect(session.defaultWorkingDirectory).toBe('/workspace')
  })

  test(`falls back to ${DEFAULT_WORKING_DIRECTORY} when workdir is missing`, async () => {
    const mock = new MockSandbox({ config: {} })
    const session = await newSession({ mock })
    expect(session.defaultWorkingDirectory).toBe(DEFAULT_WORKING_DIRECTORY)
  })

  test('falls back when workdir is an empty string', async () => {
    const mock = new MockSandbox({ config: { workdir: '' } })
    const session = await newSession({ mock })
    expect(session.defaultWorkingDirectory).toBe(DEFAULT_WORKING_DIRECTORY)
  })
})

describe('MicrosandboxNetworkSandboxSession — ports', () => {
  test('exposes the configured host ports in declared order', async () => {
    const session = await newSession({
      ports: [
        { port: 8080, bind: '127.0.0.1' },
        { port: 9090, bind: '0.0.0.0' },
        { port: 4000, bind: '127.0.0.1' },
      ],
    })
    expect(session.ports).toEqual([8080, 9090, 4000])
  })
})

describe('MicrosandboxNetworkSandboxSession — getPortUrl', () => {
  test('returns http://127.0.0.1:<port> for loopback-bound ports', async () => {
    const session = await newSession({
      ports: [{ port: 8080, bind: '127.0.0.1' }],
    })
    expect(await session.getPortUrl({ port: 8080 })).toBe(
      'http://127.0.0.1:8080',
    )
  })

  test('honors publicHostname for 0.0.0.0-bound ports', async () => {
    const session = await newSession({
      ports: [{ port: 9090, bind: '0.0.0.0' }],
      publicHostname: 'sandbox.example.com',
    })
    expect(await session.getPortUrl({ port: 9090 })).toBe(
      'http://sandbox.example.com:9090',
    )
  })

  test('throws for ports not in the resolved set', async () => {
    const session = await newSession({
      ports: [{ port: 8080, bind: '127.0.0.1' }],
    })
    await expect(session.getPortUrl({ port: 9999 })).rejects.toThrow()
  })
})

describe('MicrosandboxNetworkSandboxSession — stop', () => {
  test('calls sandbox.stop() when ownsLifecycle is true', async () => {
    const mock = new MockSandbox()
    const session = await newSession({ mock, ownsLifecycle: true })
    await session.stop()
    expect(mock.stopCalls).toBe(1)
  })

  test('is a no-op when ownsLifecycle is false', async () => {
    const mock = new MockSandbox()
    const session = await newSession({ mock, ownsLifecycle: false })
    await session.stop()
    expect(mock.stopCalls).toBe(0)
  })
})

describe('MicrosandboxNetworkSandboxSession — destroy', () => {
  test('calls sandbox.stop() when ownsLifecycle is true', async () => {
    const mock = new MockSandbox()
    const session = await newSession({ mock, ownsLifecycle: true })
    // destroy() also calls Sandbox.remove(name) — that's the static class
    // method on the real microsandbox class, not on our mock. The .catch(()
    // => {}) wrap means it doesn't fail the test even when remove throws.
    await session.destroy()
    expect(mock.stopCalls).toBe(1)
  })

  test('is a no-op when ownsLifecycle is false', async () => {
    const mock = new MockSandbox()
    const session = await newSession({ mock, ownsLifecycle: false })
    await session.destroy()
    expect(mock.stopCalls).toBe(0)
  })

  test('swallows errors from sandbox.stop()', async () => {
    const mock = new MockSandbox({ stopError: new Error('stop failed') })
    const session = await newSession({ mock, ownsLifecycle: true })
    await expect(session.destroy()).resolves.toBeUndefined()
  })
})

describe('MicrosandboxNetworkSandboxSession — restricted', () => {
  test('returns a MicrosandboxSandboxSession over the same sandbox', async () => {
    const mock = new MockSandbox({ name: 'shared' })
    const session = await newSession({ mock })
    const restricted = session.restricted()
    expect(restricted).toBeInstanceOf(MicrosandboxSandboxSession)
    // The restricted view shares the underlying sandbox, so the description
    // mentions the same name.
    expect(restricted.description).toContain('shared')
  })
})
