import { createHash } from 'node:crypto'
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
 * Includes a non-reversible hash of the API key so two contributors using
 * different keys do not share a snapshot. We deliberately avoid embedding
 * any verbatim fragment of the key because the identity surfaces in
 * snapshot names, on-disk metadata, and `msb` listings. The `v1` version
 * marker can be bumped if a future change invalidates the bootstrap.
 */
function codexIdentity(): string {
  const key = process.env.OPENAI_API_KEY ?? ''
  const fingerprint = key
    ? createHash('sha256').update(key).digest('hex').slice(0, 12)
    : 'noenv'
  return `codex-e2e-v1-${fingerprint}`
}

const SHARED_CACHE_ROOT = join(tmpdir(), 'ai-sdk-microsandbox-e2e-shared')

export interface SharedCodexHarness {
  readonly agent: HarnessAgent
  readonly identity: string
}

/**
 * Build the (harness, sandbox-provider) pair the e2e suite uses everywhere.
 * Each test file gets a fresh `HarnessAgent` over the same shared snapshot.
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
      cpus: input?.cpus ?? 1,
      memory: input?.memory ?? 1024,
      workdir: input?.workdir ?? '/root',
      ports: [{ host: CODEX_BRIDGE_PORT, guest: CODEX_BRIDGE_PORT }],
      env: input?.env,
      // Two slim-image gotchas the codex bootstrap depends on:
      // (1) `pnpm install` (corepack ships in the node image but the pnpm
      //     shim is opt-in via `corepack enable pnpm`)
      // (2) TLS to api.openai.com (slim images omit ca-certificates).
      bootstrapPreCommands: [
        'apt-get update -qq && apt-get install -y --no-install-recommends ca-certificates >/dev/null && update-ca-certificates -f >/dev/null',
        'corepack enable pnpm',
      ],
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
