import { expect, test } from 'bun:test'
import { HarnessAgent } from '@ai-sdk/harness/agent'
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel'
import { createAcpxHarness } from '../../src/acpx-harness.ts'
import { describeForAgent, readBridgeAssetFromDist } from './helpers.ts'

const AGENT = 'codex'
// Vercel sandbox boot is on the order of seconds once the bootstrap
// snapshot exists. Five minutes is plenty of headroom for a cold-snapshot
// first run, and short enough that a stuck bridge fails the test instead
// of stalling CI.
const SESSION_TIMEOUT_MS = 5 * 60 * 1000
const BRIDGE_PORT = 4001

/**
 * The harness's bootstrap recipe pre-warms `@agentclientprotocol/codex-acp`
 * (the package acpx invokes for the codex agent) via `npx --yes ...
 * --version`, so the test only needs to thread the OpenAI key through
 * `settings.auth`. The harness then writes it to `~/.acpx/config.json`
 * and sets `ACPX_AUTH_OPENAI_API_KEY` per session (the channels that
 * drive acpx's auth gate per https://acpx.sh/config.html).
 *
 * `readBridgeAsset` points the bootstrap at `dist/bridge/` because this
 * test imports `createAcpxHarness` from `src/`, where
 * `defaultReadBridgeAsset` would look for a bundled `index.js` next to
 * its own module. `test:e2e` runs `bun run build` first so
 * `dist/bridge/` is always present here.
 */
const buildAgent = () => {
  const harness = createAcpxHarness({
    agent: 'codex',
    readBridgeAsset: readBridgeAssetFromDist,
    auth: {
      // biome-ignore lint/style/noNonNullAssertion: the describe-gate guarantees this is set
      openai_api_key: process.env.OPENAI_API_KEY!,
    },
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
