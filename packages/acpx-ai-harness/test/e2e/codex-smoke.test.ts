import { expect, test } from 'bun:test'
import { HarnessAgent } from '@ai-sdk/harness/agent'
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel'
import { createAcpxHarness } from '../../src/acpx-harness.ts'
import {
  collectAgentEnv,
  describeForAgent,
  readBridgeAssetFromDist,
} from './helpers.ts'

const AGENT = 'codex'
// 15 min: cold-start sandbox snapshot creation can take several minutes
// (Vercel's `getOrCreate` builds the template from the bootstrap recipe
// on the first run). Subsequent runs should reuse the snapshot.
const SESSION_TIMEOUT_MS = 15 * 60 * 1000
const BRIDGE_PORT = 4001

/**
 * The harness's bootstrap recipe handles the codex install inside the
 * sandbox (via `npm install -g @openai/codex`), so the test just needs
 * to forward `OPENAI_API_KEY` into the sandbox env at creation time.
 *
 * The `readBridgeAsset` override points the bootstrap at `dist/bridge/`
 * because this test imports `createAcpxHarness` from `src/`, where
 * `defaultReadBridgeAsset` would look for the bundled `index.js` next to
 * its own module (and find only the unbuilt source). The `test:e2e`
 * script runs `bun run build` first, so `dist/bridge/` is always
 * present here.
 */
const buildAgent = () => {
  const harness = createAcpxHarness({
    agent: 'codex',
    readBridgeAsset: readBridgeAssetFromDist,
    // Cold-start sandboxes take a while to ship the bridge bundle
    // through the bootstrap recipe; give the bridge plenty of headroom
    // to come up.
    startupTimeoutMs: 5 * 60 * 1000,
  })
  // @vercel/sandbox's getCredentials prefers an OIDC token (via
  // `npx vercel link` + `vercel env pull`) but also accepts explicit
  // params. We pass token / teamId / projectId from env so the test
  // doesn't depend on a local .env.local.
  //
  // `ports: [BRIDGE_PORT]` is required: bridge-backed harness adapters
  // need at least one port exposed by the sandbox for the host to
  // reach the in-sandbox bridge WebSocket. The adapter picks the
  // first sandbox port for the bridge unless settings.port overrides.
  const sandbox = createVercelSandbox({
    // biome-ignore lint/style/noNonNullAssertion: the describe-gate guarantees these are set
    token: process.env.VERCEL_TOKEN!,
    // biome-ignore lint/style/noNonNullAssertion: same
    teamId: process.env.VERCEL_TEAM_ID!,
    // biome-ignore lint/style/noNonNullAssertion: same
    projectId: process.env.VERCEL_PROJECT_ID!,
    runtime: 'node22',
    ports: [BRIDGE_PORT],
    env: collectAgentEnv(AGENT),
  })
  return new HarnessAgent({ harness, sandbox })
}

describeForAgent(AGENT, 'acpx-ai-harness e2e (codex)', () => {
  test(
    'generate() returns text from a real codex turn',
    async () => {
      const agent = buildAgent()
      const session = await agent.createSession()
      try {
        const result = await agent.generate({
          session,
          prompt:
            'Reply with exactly the single word "ready" and nothing else.',
        })
        expect(typeof result.text).toBe('string')
        expect(result.text.length).toBeGreaterThan(0)
      } finally {
        await session.destroy()
      }
    },
    SESSION_TIMEOUT_MS,
  )

  test(
    'stream() yields incremental text-delta parts',
    async () => {
      const agent = buildAgent()
      const session = await agent.createSession()
      try {
        const result = await agent.stream({
          session,
          prompt: 'List the numbers 1, 2, and 3 each on a new line, then stop.',
        })
        const types: string[] = []
        for await (const part of result.fullStream) {
          types.push(part.type)
        }
        expect(types).toContain('text-delta')
        expect(types).toContain('finish')
      } finally {
        await session.destroy()
      }
    },
    SESSION_TIMEOUT_MS,
  )
})
