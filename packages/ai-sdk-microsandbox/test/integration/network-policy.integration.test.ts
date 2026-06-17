import { afterAll, expect, test } from 'bun:test'
import type { HarnessV1NetworkSandboxSession } from '@ai-sdk/harness'
import { createMicrosandbox } from '../../src/microsandbox-provider.ts'
import {
  DEFAULT_INTEGRATION_IMAGE,
  INTEGRATION_TEST_TIMEOUT_MS,
  requireIntegrationEnv,
} from './_setup.ts'

const describeIntegration = requireIntegrationEnv()

/**
 * Probe TCP reachability using bash's `/dev/tcp` virtual device. Works on
 * the slim debian image without curl or wget. Returns true when the host:port
 * was reachable within ~5s.
 */
async function tcpProbe(
  session: HarnessV1NetworkSandboxSession,
  host: string,
  port: number,
): Promise<boolean> {
  const { exitCode } = await session.run({
    command: `timeout 5 bash -c 'echo > /dev/tcp/${host}/${port}' 2>/dev/null`,
  })
  return exitCode === 0
}

describeIntegration('microsandbox — network policy enforcement', () => {
  const sessions: HarnessV1NetworkSandboxSession[] = []

  afterAll(async () => {
    for (const s of sessions) {
      if (!s.destroy) continue
      try {
        await s.destroy()
      } catch {
        // Best-effort cleanup.
      }
    }
  }, INTEGRATION_TEST_TIMEOUT_MS)

  test(
    'allow-all policy permits outbound TCP',
    async () => {
      const provider = createMicrosandbox({
        image: DEFAULT_INTEGRATION_IMAGE,
        networkPolicy: { mode: 'allow-all' },
      })
      const session = await provider.createSession()
      sessions.push(session)
      const reachable = await tcpProbe(session, 'example.com', 443)
      expect(reachable).toBe(true)
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )

  test(
    'deny-all policy blocks outbound TCP',
    async () => {
      const provider = createMicrosandbox({
        image: DEFAULT_INTEGRATION_IMAGE,
        networkPolicy: { mode: 'deny-all' },
      })
      const session = await provider.createSession()
      sessions.push(session)
      const reachable = await tcpProbe(session, 'example.com', 443)
      expect(reachable).toBe(false)
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )

  test(
    'custom + allowedHosts permits listed host, blocks unlisted host',
    async () => {
      const provider = createMicrosandbox({
        image: DEFAULT_INTEGRATION_IMAGE,
        networkPolicy: {
          mode: 'custom',
          allowedHosts: ['example.com'],
        },
      })
      const session = await provider.createSession()
      sessions.push(session)
      const allowed = await tcpProbe(session, 'example.com', 443)
      const denied = await tcpProbe(session, 'iana.org', 443)
      expect(allowed).toBe(true)
      expect(denied).toBe(false)
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )

  test(
    'deniedCIDRs takes precedence over allowedHosts that resolve into the same range',
    async () => {
      // Pin a host that historically resolves into a known public range; the
      // deniedCIDRs rule must short-circuit even though allowedHosts covers it.
      // We don't depend on a specific IP — we use 0.0.0.0/0 deny + a host allow
      // to force the deny to win regardless of resolution. This proves the
      // ordering, not a specific routing decision.
      const provider = createMicrosandbox({
        image: DEFAULT_INTEGRATION_IMAGE,
        networkPolicy: {
          mode: 'custom',
          allowedHosts: ['example.com'],
          deniedCIDRs: ['0.0.0.0/0'],
        },
      })
      const session = await provider.createSession()
      sessions.push(session)
      const reachable = await tcpProbe(session, 'example.com', 443)
      expect(reachable).toBe(false)
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  )
})
