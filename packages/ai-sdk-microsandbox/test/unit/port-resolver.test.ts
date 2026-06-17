import { describe, expect, test } from 'bun:test'
import { HarnessCapabilityUnsupportedError } from '@ai-sdk/harness'
import { PortResolver } from '../../src/port-resolver.ts'

function newResolver(input: {
  ports?: Array<{ port: number; bind: string }>
  publicHostname?: string
}): PortResolver {
  return new PortResolver({
    ports: input.ports ?? [{ port: 8080, bind: '127.0.0.1' }],
    publicHostname: input.publicHostname,
    providerId: 'microsandbox',
  })
}

describe('PortResolver', () => {
  test('loopback bind returns http://127.0.0.1:<port> by default', () => {
    const resolver = newResolver({ ports: [{ port: 8080, bind: '127.0.0.1' }] })
    expect(resolver.resolve({ port: 8080 })).toBe('http://127.0.0.1:8080')
  })

  test('unspecified bind (0.0.0.0) without publicHostname falls back to 127.0.0.1', () => {
    const resolver = newResolver({ ports: [{ port: 9090, bind: '0.0.0.0' }] })
    expect(resolver.resolve({ port: 9090 })).toBe('http://127.0.0.1:9090')
  })

  test('unspecified bind (0.0.0.0) with publicHostname uses the configured hostname', () => {
    const resolver = newResolver({
      ports: [{ port: 9090, bind: '0.0.0.0' }],
      publicHostname: 'sandbox.example.com',
    })
    expect(resolver.resolve({ port: 9090 })).toBe(
      'http://sandbox.example.com:9090',
    )
  })

  test('IPv6 unspecified bind (::) follows the same fallback rules', () => {
    const resolver = newResolver({
      ports: [{ port: 9090, bind: '::' }],
      publicHostname: 'host.example',
    })
    expect(resolver.resolve({ port: 9090 })).toBe('http://host.example:9090')
  })

  test('protocol "https" returns an https URL', () => {
    const resolver = newResolver({ ports: [{ port: 443, bind: '127.0.0.1' }] })
    expect(resolver.resolve({ port: 443, protocol: 'https' })).toBe(
      'https://127.0.0.1:443',
    )
  })

  test('protocol "ws" returns a ws URL', () => {
    const resolver = newResolver({ ports: [{ port: 4000, bind: '127.0.0.1' }] })
    expect(resolver.resolve({ port: 4000, protocol: 'ws' })).toBe(
      'ws://127.0.0.1:4000',
    )
  })

  test('unknown port throws HarnessCapabilityUnsupportedError', () => {
    const resolver = newResolver({ ports: [{ port: 8080, bind: '127.0.0.1' }] })
    expect(() => resolver.resolve({ port: 9999 })).toThrow(
      HarnessCapabilityUnsupportedError,
    )
  })

  test('error message lists the exposed ports', () => {
    const resolver = newResolver({
      ports: [
        { port: 8080, bind: '127.0.0.1' },
        { port: 9090, bind: '127.0.0.1' },
      ],
    })
    try {
      resolver.resolve({ port: 9999 })
      throw new Error('expected to throw')
    } catch (error) {
      expect((error as Error).message).toContain('8080')
      expect((error as Error).message).toContain('9090')
    }
  })

  test('specific bind address (not loopback, not unspecified) is used verbatim', () => {
    const resolver = newResolver({
      ports: [{ port: 8080, bind: '10.0.0.5' }],
    })
    expect(resolver.resolve({ port: 8080 })).toBe('http://10.0.0.5:8080')
  })
})
