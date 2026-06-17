import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HarnessAgent } from '@ai-sdk/harness/agent'
import { createCodex } from '@ai-sdk/harness-codex'
import { createMicrosandbox } from '../../../src/microsandbox-provider.ts'
import { CODEX_BRIDGE_PORT, CODEX_E2E_IMAGE } from '../_setup.ts'

/**
 * Identity tag used across every Codex e2e test in a single run. All tests
 * in the suite share one bootstrapped snapshot: the first test pays the
 * cost of installing the Codex CLI; the rest fork from the snapshot in ~1s.
 *
 * Includes a 4-char tail of the API key so two contributors using different
 * keys do not share a snapshot, and a `v1` version marker we can bump if a
 * future change invalidates the bootstrap.
 */
function codexIdentity(): string {
  const tail = process.env.OPENAI_API_KEY?.slice(-4) ?? 'noenv'
  return `codex-e2e-v1-${tail}`
}

const SHARED_CACHE_ROOT = join(tmpdir(), 'ai-sdk-microsandbox-e2e-shared')

export interface SharedCodexHarness {
  readonly agent: HarnessAgent
  readonly identity: string
}

/**
 * Build the (harness, sandbox-provider) pair the e2e suite uses everywhere.
 * Each test file gets a fresh `HarnessAgent` over the same shared snapshot —
 * sessions are independent, but bootstrap runs once per process.
 */
export function buildSharedCodexHarness(input?: {
  cpus?: number
  memory?: number
  workdir?: string
  env?: Record<string, string>
}): SharedCodexHarness {
  const identity = codexIdentity()
  const provider = createMicrosandbox(
    {
      image: CODEX_E2E_IMAGE,
      cpus: input?.cpus ?? 2,
      memory: input?.memory ?? 2048,
      workdir: input?.workdir ?? '/workspace',
      ports: [{ host: CODEX_BRIDGE_PORT, guest: CODEX_BRIDGE_PORT }],
      env: input?.env,
    },
    { templateCacheOptions: { cacheRoot: SHARED_CACHE_ROOT } },
  )
  const harness = createCodex({
    model: process.env.CODEX_E2E_MODEL,
    reasoningEffort: 'low',
    auth: {
      openai: {
        // biome-ignore lint/style/noNonNullAssertion: the e2e gate guarantees this is set
        apiKey: process.env.OPENAI_API_KEY!,
      },
    },
    port: CODEX_BRIDGE_PORT,
  })
  return {
    agent: new HarnessAgent({ harness, sandbox: provider }),
    identity,
  }
}
