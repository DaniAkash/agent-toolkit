import { describe, expect, test } from 'bun:test'
import { NetworkPolicyBuilder } from 'microsandbox'
import { translateNetworkPolicy } from '../../src/network-policy.ts'

interface BuiltPolicy {
  defaultEgress: string
  defaultIngress: string
  rules: Array<{ action: string; destination?: { kind?: string } }>
}

function buildPolicy(builder: NetworkPolicyBuilder): BuiltPolicy {
  return builder.build() as unknown as BuiltPolicy
}

describe('translateNetworkPolicy', () => {
  test('"allow-all" → builder with default-allow', () => {
    const builder = translateNetworkPolicy({ mode: 'allow-all' })
    const policy = buildPolicy(builder) as {
      defaultEgress: string
      defaultIngress: string
      rules: unknown[]
    }
    expect(policy.defaultEgress).toBe('allow')
    expect(policy.defaultIngress).toBe('allow')
    expect(policy.rules).toEqual([])
  })

  test('"deny-all" → builder with default-deny', () => {
    const builder = translateNetworkPolicy({ mode: 'deny-all' })
    const policy = buildPolicy(builder) as {
      defaultEgress: string
      defaultIngress: string
      rules: unknown[]
    }
    expect(policy.defaultEgress).toBe('deny')
    expect(policy.defaultIngress).toBe('deny')
    expect(policy.rules).toEqual([])
  })

  test('"custom" with empty allow/deny → bare deny-all', () => {
    const builder = translateNetworkPolicy({
      mode: 'custom',
      allowedHosts: [],
    })
    const policy = buildPolicy(builder) as {
      defaultEgress: string
      rules: unknown[]
    }
    expect(policy.defaultEgress).toBe('deny')
    expect(policy.rules).toEqual([])
  })

  test('"custom" with one allowed host → one allow rule', () => {
    const builder = translateNetworkPolicy({
      mode: 'custom',
      allowedHosts: ['api.example.com'],
    })
    const policy = buildPolicy(builder) as { rules: unknown[] }
    expect(policy.rules).toHaveLength(1)
  })

  test('"custom" with multiple allowed hosts → one rule per host', () => {
    const builder = translateNetworkPolicy({
      mode: 'custom',
      allowedHosts: ['api.example.com', 'cdn.example.com', 'auth.example.com'],
    })
    const policy = buildPolicy(builder) as { rules: unknown[] }
    expect(policy.rules).toHaveLength(3)
  })

  test('"custom" with allowed CIDRs → allow.cidr rules', () => {
    const builder = translateNetworkPolicy({
      mode: 'custom',
      allowedCIDRs: ['10.0.0.0/8', '192.168.0.0/16'],
    })
    const policy = buildPolicy(builder) as { rules: unknown[] }
    expect(policy.rules).toHaveLength(2)
  })

  test('"custom" with denied CIDRs → deny.cidr rules', () => {
    const builder = translateNetworkPolicy({
      mode: 'custom',
      allowedCIDRs: ['10.0.0.0/8'],
      deniedCIDRs: ['10.1.2.0/24'],
    })
    const policy = buildPolicy(builder) as { rules: unknown[] }
    expect(policy.rules).toHaveLength(2)
  })

  test('"custom" with all three lists → expected total rule count', () => {
    const builder = translateNetworkPolicy({
      mode: 'custom',
      allowedHosts: ['api.example.com', 'cdn.example.com'],
      allowedCIDRs: ['10.0.0.0/8'],
      deniedCIDRs: ['10.1.2.0/24', '169.254.169.254/32'],
    })
    const policy = buildPolicy(builder) as { rules: unknown[] }
    // 2 hosts + 1 allow cidr + 2 deny cidrs = 5
    expect(policy.rules).toHaveLength(5)
  })

  test('the returned builder is a valid NetworkPolicyBuilder', () => {
    const builder = translateNetworkPolicy({ mode: 'allow-all' })
    expect(builder).toBeInstanceOf(NetworkPolicyBuilder)
    // build() should not throw on the translated policy
    expect(() => builder.build()).not.toThrow()
  })

  test('rule order: deny.cidr rules emit BEFORE allow rules', () => {
    const builder = translateNetworkPolicy({
      mode: 'custom',
      allowedCIDRs: ['10.0.0.0/8'],
      deniedCIDRs: ['10.1.2.0/24'],
    })
    const policy = buildPolicy(builder) as {
      rules: Array<{ action: string }>
    }
    // Deny first, allow second. Under first-match evaluators the deny wins
    // for any address covered by both, giving deniedCIDRs the precedence the
    // harness contract requires.
    expect(policy.rules[0]?.action).toBe('deny')
    expect(policy.rules[1]?.action).toBe('allow')
  })
})
