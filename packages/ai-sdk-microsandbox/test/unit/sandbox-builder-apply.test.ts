import { describe, expect, test } from 'bun:test'
import {
  applyCreateSettings,
  applyForkSettings,
} from '../../src/internal/sandbox-builder-apply.ts'
import { MockSandboxBuilder } from '../helpers/mock-sandbox-builder.ts'

function newBuilder(): MockSandboxBuilder {
  return new MockSandboxBuilder()
}

describe('applyCreateSettings — basic threading', () => {
  test('always calls image()', () => {
    const b = newBuilder()
    applyCreateSettings(b.asSandboxBuilder(), { image: 'debian' })
    expect(b.calls[0]).toEqual({ method: 'image', image: 'debian' })
  })

  test('threads cpus, memory, workdir, envs', () => {
    const b = newBuilder()
    applyCreateSettings(b.asSandboxBuilder(), {
      image: 'debian',
      cpus: 2,
      memory: 4096,
      workdir: '/workspace',
      env: { FOO: 'bar' },
    })
    expect(b.calls).toEqual([
      { method: 'image', image: 'debian' },
      { method: 'cpus', cpus: 2 },
      { method: 'memory', mib: 4096 },
      { method: 'workdir', path: '/workspace' },
      { method: 'envs', env: { FOO: 'bar' } },
    ])
  })

  test('skips optional fields when undefined', () => {
    const b = newBuilder()
    applyCreateSettings(b.asSandboxBuilder(), { image: 'debian' })
    expect(b.calls.map((c) => c.method)).toEqual(['image'])
  })
})

describe('applyCreateSettings — replace handling', () => {
  test('replace: true → builder.replace()', () => {
    const b = newBuilder()
    applyCreateSettings(b.asSandboxBuilder(), {
      image: 'debian',
      replace: true,
    })
    expect(b.calls.some((c) => c.method === 'replace')).toBe(true)
  })

  test('replace: false → no replace call', () => {
    const b = newBuilder()
    applyCreateSettings(b.asSandboxBuilder(), {
      image: 'debian',
      replace: false,
    })
    expect(b.calls.some((c) => c.method === 'replace')).toBe(false)
    expect(b.calls.some((c) => c.method === 'replaceWithTimeout')).toBe(false)
  })

  test('replace: { timeoutMs } → builder.replaceWithTimeout()', () => {
    const b = newBuilder()
    applyCreateSettings(b.asSandboxBuilder(), {
      image: 'debian',
      replace: { timeoutMs: 5000 },
    })
    expect(b.calls).toContainEqual({
      method: 'replaceWithTimeout',
      timeoutMs: 5000,
    })
  })
})

describe('applyCreateSettings — port routing', () => {
  test('TCP without bind → builder.port()', () => {
    const b = newBuilder()
    applyCreateSettings(b.asSandboxBuilder(), {
      image: 'debian',
      ports: [{ host: 8080, guest: 80 }],
    })
    expect(b.calls).toContainEqual({ method: 'port', host: 8080, guest: 80 })
  })

  test('TCP with implicit 127.0.0.1 bind → builder.port() (not portBind)', () => {
    const b = newBuilder()
    applyCreateSettings(b.asSandboxBuilder(), {
      image: 'debian',
      ports: [{ host: 8080, guest: 80, bind: '127.0.0.1' }],
    })
    expect(b.calls).toContainEqual({ method: 'port', host: 8080, guest: 80 })
    expect(b.calls.some((c) => c.method === 'portBind')).toBe(false)
  })

  test('TCP with 0.0.0.0 bind → builder.portBind()', () => {
    const b = newBuilder()
    applyCreateSettings(b.asSandboxBuilder(), {
      image: 'debian',
      ports: [{ host: 9090, guest: 90, bind: '0.0.0.0' }],
    })
    expect(b.calls).toContainEqual({
      method: 'portBind',
      bind: '0.0.0.0',
      host: 9090,
      guest: 90,
    })
  })

  test('UDP without bind → builder.portUdp()', () => {
    const b = newBuilder()
    applyCreateSettings(b.asSandboxBuilder(), {
      image: 'debian',
      ports: [{ host: 7000, guest: 70, protocol: 'udp' }],
    })
    expect(b.calls).toContainEqual({
      method: 'portUdp',
      host: 7000,
      guest: 70,
    })
  })

  test('UDP with bind → builder.portUdpBind()', () => {
    const b = newBuilder()
    applyCreateSettings(b.asSandboxBuilder(), {
      image: 'debian',
      ports: [{ host: 7000, guest: 70, protocol: 'udp', bind: '0.0.0.0' }],
    })
    expect(b.calls).toContainEqual({
      method: 'portUdpBind',
      bind: '0.0.0.0',
      host: 7000,
      guest: 70,
    })
  })

  test('multiple ports preserve declaration order', () => {
    const b = newBuilder()
    applyCreateSettings(b.asSandboxBuilder(), {
      image: 'debian',
      ports: [
        { host: 8080, guest: 80 },
        { host: 9090, guest: 90 },
        { host: 4000, guest: 40 },
      ],
    })
    const portCalls = b.calls.filter((c) => c.method === 'port')
    expect(portCalls.map((c) => (c as { host: number }).host)).toEqual([
      8080, 9090, 4000,
    ])
  })
})

describe('applyCreateSettings — network policy', () => {
  test('calls builder.network() exactly once when networkPolicy is set', () => {
    const b = newBuilder()
    applyCreateSettings(b.asSandboxBuilder(), {
      image: 'debian',
      networkPolicy: { mode: 'allow-all' },
    })
    expect(b.calls.filter((c) => c.method === 'network')).toHaveLength(1)
  })

  test('does not call builder.network() when networkPolicy is unset', () => {
    const b = newBuilder()
    applyCreateSettings(b.asSandboxBuilder(), { image: 'debian' })
    expect(b.calls.some((c) => c.method === 'network')).toBe(false)
  })
})

describe('applyForkSettings', () => {
  test('does NOT call image() — the snapshot already pins it', () => {
    const b = newBuilder()
    applyForkSettings(b.asSandboxBuilder(), {
      image: 'debian',
      cpus: 2,
    })
    expect(b.calls.some((c) => c.method === 'image')).toBe(false)
  })

  test('applies runtime-only settings (cpus / memory / workdir / env)', () => {
    const b = newBuilder()
    applyForkSettings(b.asSandboxBuilder(), {
      image: 'debian',
      cpus: 4,
      memory: 4096,
      workdir: '/workspace',
      env: { FOO: 'bar' },
    })
    const methods = b.calls.map((c) => c.method)
    expect(methods).toContain('cpus')
    expect(methods).toContain('memory')
    expect(methods).toContain('workdir')
    expect(methods).toContain('envs')
  })

  test('applies ports and networkPolicy at fork time', () => {
    const b = newBuilder()
    applyForkSettings(b.asSandboxBuilder(), {
      image: 'debian',
      ports: [{ host: 8080, guest: 80 }],
      networkPolicy: { mode: 'allow-all' },
    })
    const methods = b.calls.map((c) => c.method)
    expect(methods).toContain('port')
    expect(methods).toContain('network')
  })
})
