/**
 * Regression guards for the capability surface the SDK's stable v1
 * entrypoint does not type.
 *
 * `fork`, `systemPrompt`, `providers` and `mcpCapabilities.acp` exist only
 * in the unstable schema. Both entrypoints pass them through at runtime, so
 * the risk is not losing the data: it is reporting it under a generic bag
 * (or not at all) because the types do not name it. These tests fail if the
 * package is moved back to the stable entrypoint and the fields are dropped
 * from `AgentCapabilities`.
 */
import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InitializeResponse } from '@agentclientprotocol/sdk/unstable'
import { normalizeCapabilities } from '../../src/_internal/normalize.ts'

const FIXTURES = new URL('../fixtures/', import.meta.url).pathname

async function load(name: string): Promise<InitializeResponse> {
  const raw = await readFile(join(FIXTURES, name), 'utf8')
  return JSON.parse(raw) as InitializeResponse
}

describe('unstable capability reporting', () => {
  test('mcpCapabilities.acp is a named transport, not a meta key', async () => {
    const caps = normalizeCapabilities(
      await load('unstable-caps-initialize.json'),
    )
    expect(caps.mcpCapabilities.acp).toBe(true)
    // The whole point: it must not be swept into the catch-all.
    expect(caps.mcpCapabilities.meta).toBeUndefined()
  })

  test('acp is false, not undefined, when the agent omits it', async () => {
    const caps = normalizeCapabilities(await load('claude-initialize.json'))
    expect(caps.mcpCapabilities.acp).toBe(false)
  })

  test('fork and systemPrompt are reported from the session capabilities', async () => {
    const caps = normalizeCapabilities(
      await load('unstable-caps-initialize.json'),
    )
    expect(caps.sessionCapabilities).toEqual({
      close: true,
      list: true,
      resume: true,
      fork: true,
      systemPrompt: true,
      additionalDirectories: true,
    })
  })

  test('sub-capabilities handle the object spelling and null', async () => {
    const caps = normalizeCapabilities({
      protocolVersion: 1,
      agentCapabilities: { sessionCapabilities: { close: {}, list: null } },
    } as unknown as InitializeResponse)
    expect(caps.sessionCapabilities.close).toBe(true)
    expect(caps.sessionCapabilities.list).toBe(false)
  })

  test('an off-spec boolean false is not reported as supported', async () => {
    // The object spelling makes presence and truthiness agree, since `{}`
    // is truthy. They diverge only here, on the pre-object boolean form a
    // bare `!= null` check reads as supported.
    const caps = normalizeCapabilities({
      protocolVersion: 1,
      agentCapabilities: {
        sessionCapabilities: { close: false, fork: true, list: {} },
      },
    } as unknown as InitializeResponse)
    expect(caps.sessionCapabilities.close).toBe(false)
    expect(caps.sessionCapabilities.fork).toBe(true)
    expect(caps.sessionCapabilities.list).toBe(true)
  })

  test('providers lands in the experimental bucket verbatim', async () => {
    const caps = normalizeCapabilities(
      await load('unstable-caps-initialize.json'),
    )
    expect(caps.experimental?.providers).toEqual({ configurable: true })
  })

  test('an unrecognised agent capability survives into experimental', async () => {
    // Pass-through, not an allowlist. A capability ACP adds after this
    // package was published must still reach the caller, or the probe is
    // lying by omission. This guards the behaviour, not the list.
    const caps = normalizeCapabilities(
      await load('unstable-caps-initialize.json'),
    )
    expect(caps.experimental?.someFutureCapability).toEqual({ version: 9 })
  })

  test('an unrecognised MCP transport survives into mcpCapabilities.meta', async () => {
    const caps = normalizeCapabilities({
      protocolVersion: 1,
      agentCapabilities: {
        mcpCapabilities: { http: true, sse: false, futureTransport: true },
      },
    } as unknown as InitializeResponse)
    expect(caps.mcpCapabilities.meta).toEqual({ futureTransport: true })
  })

  test('named capability groups do not leak into experimental', async () => {
    const caps = normalizeCapabilities(
      await load('unstable-caps-initialize.json'),
    )
    for (const named of [
      'loadSession',
      'promptCapabilities',
      'mcpCapabilities',
      'sessionCapabilities',
    ]) {
      expect(caps.experimental?.[named]).toBeUndefined()
    }
  })
})
