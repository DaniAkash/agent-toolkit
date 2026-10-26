import { describe, expect, test } from 'bun:test'
import { createAcpxProvider } from '../../src/index.ts'

// buildRuntimeOptions is private, so assert through what the runtime factory
// receives: that is the contract these settings exist to satisfy.
function capture(settings: Record<string, unknown>): Record<string, unknown> {
  const provider = createAcpxProvider({
    agent: 'claude',
    cwd: '/tmp/t',
    ...settings,
  })
  const internal = provider as unknown as {
    buildRuntimeOptions: () => Record<string, unknown>
  }
  return internal.buildRuntimeOptions.call(provider)
}

describe('embedding options pass-through', () => {
  test('omits every new option when unset, so acpx defaults apply', () => {
    const opts = capture({})
    for (const key of [
      'agentProcessEnv',
      'agentProcessEnvAllow',
      'agentProcessEnvBlock',
      'fs',
      'terminal',
      'processLifecycle',
      'sessionPermissions',
    ]) {
      expect(Object.hasOwn(opts, key)).toBe(false)
    }
  })

  test('forwards the env isolation lists', () => {
    const opts = capture({
      agentProcessEnvAllow: ['PATH', 'HOME'],
      agentProcessEnvBlock: ['AWS_SECRET_ACCESS_KEY'],
      agentProcessEnv: { ACPX_TEST: '1' },
    })
    expect(opts.agentProcessEnvAllow).toEqual(['PATH', 'HOME'])
    expect(opts.agentProcessEnvBlock).toEqual(['AWS_SECRET_ACCESS_KEY'])
    expect(opts.agentProcessEnv).toEqual({ ACPX_TEST: '1' })
  })

  // false has to survive, which a plain truthiness check would drop. That is
  // the whole point of disabling a capability.
  test('forwards fs and terminal when explicitly false', () => {
    const opts = capture({ fs: false, terminal: false })
    expect(opts.fs).toBe(false)
    expect(opts.terminal).toBe(false)
  })

  test('forwards fs and terminal when explicitly true', () => {
    const opts = capture({ fs: true, terminal: true })
    expect(opts.fs).toBe(true)
    expect(opts.terminal).toBe(true)
  })
})
