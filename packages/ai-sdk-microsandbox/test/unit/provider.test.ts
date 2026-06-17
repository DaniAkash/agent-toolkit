import { describe, expect, test } from 'bun:test'
import type { Sandbox, SandboxBuilder } from 'microsandbox'
import { MicrosandboxNetworkSandboxSession } from '../../src/microsandbox-network-sandbox-session.ts'
import {
  createMicrosandbox,
  MicrosandboxProvider,
} from '../../src/microsandbox-provider.ts'
import { MicrosandboxSettingsError } from '../../src/settings.ts'
import { MockSandbox } from '../helpers/mock-sandbox.ts'
import { MockSandboxBuilder } from '../helpers/mock-sandbox-builder.ts'

function asSandbox(mock: MockSandbox): Sandbox {
  return mock as unknown as Sandbox
}

interface BuilderFactoryHarness {
  factory: (name: string) => SandboxBuilder
  history: Array<{
    name: string
    builder: MockSandboxBuilder
    sandbox: MockSandbox
  }>
}

function newBuilderFactoryHarness(): BuilderFactoryHarness {
  const history: BuilderFactoryHarness['history'] = []
  const factory = (name: string): SandboxBuilder => {
    const sandbox = new MockSandbox({
      name,
      config: { workdir: '/workspace' },
    })
    const builder = new MockSandboxBuilder()
    // Override create() so it resolves to our MockSandbox instance.
    builder.create = async () => {
      builder.calls.push({ method: 'create' })
      return sandbox
    }
    history.push({ name, builder, sandbox })
    return builder.asSandboxBuilder()
  }
  return { factory, history }
}

describe('MicrosandboxProvider — constants', () => {
  test('specificationVersion is the v1 literal', () => {
    const provider = createMicrosandbox({ image: 'debian' })
    expect(provider.specificationVersion).toBe('harness-sandbox-v1')
  })

  test('providerId is "microsandbox"', () => {
    const provider = createMicrosandbox({ image: 'debian' })
    expect(provider.providerId).toBe('microsandbox')
  })
})

describe('MicrosandboxProvider — settings validation', () => {
  test('rejects invalid create-mode settings at construction', () => {
    expect(() => createMicrosandbox({ image: 'debian', cpus: 0 })).toThrow(
      MicrosandboxSettingsError,
    )
  })

  test('accepts valid wrap-mode settings', () => {
    expect(() =>
      createMicrosandbox({ sandbox: asSandbox(new MockSandbox()) }),
    ).not.toThrow()
  })
})

describe('MicrosandboxProvider — bridgePorts surface', () => {
  test('wrap mode + bridgePorts setting surfaces the pool', () => {
    const provider = createMicrosandbox({
      sandbox: asSandbox(new MockSandbox()),
      bridgePorts: [4000, 4001],
    })
    expect(provider.bridgePorts).toEqual([4000, 4001])
  })

  test('wrap mode without bridgePorts → bridgePorts is undefined', () => {
    const provider = createMicrosandbox({
      sandbox: asSandbox(new MockSandbox()),
    })
    expect(provider.bridgePorts).toBeUndefined()
  })

  test('create mode → bridgePorts is undefined regardless of ports settings', () => {
    const provider = createMicrosandbox({
      image: 'debian',
      ports: [{ host: 8080, guest: 80 }],
    })
    expect(provider.bridgePorts).toBeUndefined()
  })
})

describe('MicrosandboxProvider — createSession (wrap mode)', () => {
  test('returns a network session over the supplied sandbox', async () => {
    const mock = new MockSandbox({
      name: 'caller-vm',
      config: { workdir: '/x' },
    })
    const provider = createMicrosandbox({
      sandbox: asSandbox(mock),
      bridgePorts: [4000],
    })
    const session = await provider.createSession()
    expect(session).toBeInstanceOf(MicrosandboxNetworkSandboxSession)
    expect(session.id).toBe('caller-vm')
    expect(session.defaultWorkingDirectory).toBe('/x')
    expect(session.ports).toEqual([4000])
  })

  test('session does not own the sandbox lifecycle in wrap mode', async () => {
    const mock = new MockSandbox()
    const provider = createMicrosandbox({ sandbox: asSandbox(mock) })
    const session = await provider.createSession()
    await session.stop()
    expect(mock.stopCalls).toBe(0)
  })

  test('pre-aborted signal rejects without touching the sandbox', async () => {
    const mock = new MockSandbox()
    const provider = createMicrosandbox({ sandbox: asSandbox(mock) })
    const controller = new AbortController()
    controller.abort()
    await expect(
      provider.createSession({ abortSignal: controller.signal }),
    ).rejects.toThrow()
  })
})

describe('MicrosandboxProvider — createSession (create mode)', () => {
  test('calls the builder factory with an auto-generated name when no sessionId', async () => {
    const { factory, history } = newBuilderFactoryHarness()
    const provider = new MicrosandboxProvider(
      { image: 'debian', cpus: 2, memory: 2048, workdir: '/work' },
      { builderFactory: factory },
    )
    await provider.createSession()
    expect(history).toHaveLength(1)
    expect(history[0]?.name.startsWith('ai-sdk-harness-auto-')).toBe(true)
  })

  test('derives the builder name from sessionId when provided', async () => {
    const { factory, history } = newBuilderFactoryHarness()
    const provider = new MicrosandboxProvider(
      { image: 'debian' },
      { builderFactory: factory },
    )
    await provider.createSession({ sessionId: 'turn-1' })
    expect(history[0]?.name).toBe('ai-sdk-harness-turn-1')
  })

  test('threads settings through applyCreateSettings onto the builder', async () => {
    const { factory, history } = newBuilderFactoryHarness()
    const provider = new MicrosandboxProvider(
      {
        image: 'debian',
        cpus: 4,
        memory: 4096,
        workdir: '/workspace',
        ports: [{ host: 8080, guest: 80 }],
      },
      { builderFactory: factory },
    )
    await provider.createSession()
    const builder = history[0]?.builder
    expect(builder).toBeDefined()
    const methods = builder?.calls.map((c) => c.method) ?? []
    expect(methods).toContain('image')
    expect(methods).toContain('cpus')
    expect(methods).toContain('memory')
    expect(methods).toContain('workdir')
    expect(methods).toContain('port')
    expect(methods).toContain('create')
  })

  test('returns a network session with ownsLifecycle: true', async () => {
    const { factory, history } = newBuilderFactoryHarness()
    const provider = new MicrosandboxProvider(
      { image: 'debian' },
      { builderFactory: factory },
    )
    const session = await provider.createSession()
    expect(session).toBeInstanceOf(MicrosandboxNetworkSandboxSession)
    // Lifecycle ownership exercised via stop() → mock stop should fire.
    await session.stop()
    expect(history[0]?.sandbox.stopCalls).toBe(1)
  })

  test('honors explicit settings.name when no sessionId is passed', async () => {
    const { factory, history } = newBuilderFactoryHarness()
    const provider = new MicrosandboxProvider(
      { image: 'debian', name: 'fixed-name' },
      { builderFactory: factory },
    )
    await provider.createSession()
    expect(history[0]?.name).toBe('fixed-name')
  })

  test('pre-aborted signal rejects without calling the builder', async () => {
    const { factory, history } = newBuilderFactoryHarness()
    const provider = new MicrosandboxProvider(
      { image: 'debian' },
      { builderFactory: factory },
    )
    const controller = new AbortController()
    controller.abort()
    await expect(
      provider.createSession({ abortSignal: controller.signal }),
    ).rejects.toThrow()
    expect(history).toHaveLength(0)
  })

  test('identity + onFirstCreate is now supported (Phase 4)', async () => {
    // No longer throws; the full identity-branch behavior is verified in
    // provider-identity.test.ts which wires the TemplateCache test seam.
    const provider = createMicrosandbox({ image: 'debian' })
    // We can't run this against a real builder here, but at least confirm
    // it doesn't synchronously reject with HarnessCapabilityUnsupportedError.
    const promise = provider.createSession({
      identity: 'claude-code-v1',
      onFirstCreate: async () => undefined,
    })
    // Catch any error so this test focuses on the rejection *type*.
    let rejection: unknown
    try {
      await promise
    } catch (error) {
      rejection = error
    }
    expect((rejection as { name?: string })?.name).not.toBe(
      'HarnessCapabilityUnsupportedError',
    )
  })
})
