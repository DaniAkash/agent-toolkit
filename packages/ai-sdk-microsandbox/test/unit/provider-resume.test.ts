import { describe, expect, test } from 'bun:test'
import type { Sandbox } from 'microsandbox'
import { MicrosandboxNetworkSandboxSession } from '../../src/microsandbox-network-sandbox-session.ts'
import { MicrosandboxProvider } from '../../src/microsandbox-provider.ts'
import { MockSandbox } from '../helpers/mock-sandbox.ts'

function asSandbox(mock: MockSandbox): Sandbox {
  return mock as unknown as Sandbox
}

describe('MicrosandboxProvider: resumeSession (create mode)', () => {
  test('starts the sandbox by sessionSandboxName and returns a network session', async () => {
    const calls: string[] = []
    const target = new MockSandbox({
      name: 'ai-sdk-harness-resume-1',
      config: { workdir: '/work' },
    })
    const provider = new MicrosandboxProvider(
      { image: 'debian' },
      {
        sandboxStart: async (name: string) => {
          calls.push(name)
          return asSandbox(target)
        },
      },
    )
    const session = await provider.resumeSession({ sessionId: 'resume-1' })
    expect(calls).toEqual(['ai-sdk-harness-resume-1'])
    expect(session).toBeInstanceOf(MicrosandboxNetworkSandboxSession)
    expect(session.id).toBe('ai-sdk-harness-resume-1')
    expect(session.defaultWorkingDirectory).toBe('/work')
  })

  test('returned session owns the sandbox lifecycle', async () => {
    const target = new MockSandbox({ name: 'ai-sdk-harness-resume-2' })
    const provider = new MicrosandboxProvider(
      { image: 'debian' },
      { sandboxStart: async () => asSandbox(target) },
    )
    const session = await provider.resumeSession({ sessionId: 'resume-2' })
    await session.stop()
    expect(target.stopCalls).toBe(1)
  })

  test('threads create-mode ports into the resumed session', async () => {
    const target = new MockSandbox({ name: 'ai-sdk-harness-resume-3' })
    const provider = new MicrosandboxProvider(
      {
        image: 'debian',
        ports: [
          { host: 4000, guest: 4000 },
          { host: 8080, guest: 80, bind: '0.0.0.0' },
        ],
      },
      { sandboxStart: async () => asSandbox(target) },
    )
    const session = await provider.resumeSession({ sessionId: 'resume-3' })
    expect(session.ports).toEqual([4000, 8080])
  })

  test('pre-aborted signal rejects without invoking the resume seam', async () => {
    let called = false
    const provider = new MicrosandboxProvider(
      { image: 'debian' },
      {
        sandboxStart: async () => {
          called = true
          return asSandbox(new MockSandbox())
        },
      },
    )
    const controller = new AbortController()
    controller.abort()
    await expect(
      provider.resumeSession({
        sessionId: 'r',
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow()
    expect(called).toBe(false)
  })

  test('propagates errors from the resume seam (e.g. sandbox not found)', async () => {
    const provider = new MicrosandboxProvider(
      { image: 'debian' },
      {
        sandboxStart: async () => {
          throw new Error('sandbox "ai-sdk-harness-missing" not found')
        },
      },
    )
    await expect(
      provider.resumeSession({ sessionId: 'missing' }),
    ).rejects.toThrow(/not found/)
  })
})

describe('MicrosandboxProvider: resumeSession (wrap mode)', () => {
  test('returns a wrapped session over the caller sandbox; sessionId ignored', async () => {
    const wrapped = new MockSandbox({
      name: 'caller-vm',
      config: { workdir: '/x' },
    })
    let starterCalled = false
    const provider = new MicrosandboxProvider(
      { sandbox: asSandbox(wrapped), bridgePorts: [4000] },
      {
        sandboxStart: async () => {
          starterCalled = true
          return asSandbox(wrapped)
        },
      },
    )
    const session = await provider.resumeSession({ sessionId: 'whatever' })
    expect(starterCalled).toBe(false)
    expect(session.id).toBe('caller-vm')
    expect(session.ports).toEqual([4000])
  })

  test('wrap-mode resume does not own the sandbox lifecycle', async () => {
    const wrapped = new MockSandbox({ name: 'caller-vm' })
    const provider = new MicrosandboxProvider({ sandbox: asSandbox(wrapped) })
    const session = await provider.resumeSession({ sessionId: 'anything' })
    await session.stop()
    expect(wrapped.stopCalls).toBe(0)
  })
})
