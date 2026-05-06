/**
 * End-to-end smoke tests against real ACP agents.
 *
 * NOT run in CI — these spawn real agent processes (claude / codex /
 * gemini), make real API calls, and need authenticated credentials.
 * They exist so a contributor can verify their changes against agents
 * the mock harness can't catch: npx download drift, agent CLI version
 * skew, env auth wiring, real session persistence on disk.
 *
 * How to run:
 *
 *   # Run all three agents
 *   SMOKE_AGENTS=all bun test test/e2e
 *
 *   # Run a single agent
 *   SMOKE_AGENTS=claude bun test test/e2e
 *
 *   # Run two
 *   SMOKE_AGENTS=claude,codex bun test test/e2e
 *
 * Per-agent setup (one-time):
 *
 *   - claude: needs an Anthropic API key. Set ACPX_AUTH_ANTHROPIC_API_KEY
 *     or ANTHROPIC_API_KEY (whichever the claude-agent-acp adapter
 *     reads). First run will `npx`-download the adapter (~30s).
 *
 *   - codex: needs an OpenAI key. Set ACPX_AUTH_OPENAI_API_KEY or
 *     OPENAI_API_KEY. First run will `npx`-download the adapter.
 *
 *   - gemini: needs the local `gemini` CLI installed and
 *     authenticated. Install via `npm i -g @google/gemini-cli` (or
 *     equivalent), then run `gemini auth login` first.
 *
 * What the tests cover (per agent):
 *
 *   1. Basic generateText — catches: agent spawns, ACP handshake, text
 *      deltas flow, finish part fires.
 *   2. streamText — catches: incremental delta forwarding, stream
 *      completion.
 *   3. Persistent multi-turn — catches: file-backed session store,
 *      fresh-vs-continuation prompt mode, agent context retention
 *      across our session boundary.
 *   4. JSON structured output via generateObject — catches: JSON
 *      cleanup transform against real agent output (some agents wrap
 *      output in markdown fences), schema-instruction injection.
 *   5. provider.doctor() — catches: agent registry resolution.
 */

import { describe, expect, test } from 'bun:test'
import { generateObject, generateText, stepCountIs, streamText } from 'ai'
import { z } from 'zod'
import { createAcpxProvider } from '../../src/index.ts'

const REQUESTED = (process.env.SMOKE_AGENTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const ALL_REQUESTED =
  REQUESTED.includes('all') || process.env.RUN_E2E_AGENT_TESTS === '1'
const shouldRun = (agent: string): boolean =>
  ALL_REQUESTED || REQUESTED.includes(agent)

const AGENTS = ['claude', 'codex', 'gemini'] as const
type SmokeAgent = (typeof AGENTS)[number]

const TURN_TIMEOUT_MS = 90_000
const TEST_TIMEOUT_MS = 4 * TURN_TIMEOUT_MS

const baseSettings = {
  permissionMode: 'approve-reads' as const,
  nonInteractivePermissions: 'deny' as const,
  turnTimeoutMs: TURN_TIMEOUT_MS,
}

function newProvider(agent: SmokeAgent, sessionKey?: string) {
  return createAcpxProvider({
    agent,
    cwd: process.cwd(),
    sessionKey,
    ...baseSettings,
  })
}

for (const agent of AGENTS) {
  describe.skipIf(!shouldRun(agent))(`smoke: ${agent}`, () => {
    test('doctor() returns a defined report', async () => {
      const provider = newProvider(agent, `doctor-${agent}-${Date.now()}`)
      try {
        const report = await provider.doctor()
        expect(report).toBeDefined()
        expect(typeof report.message).toBe('string')
      } finally {
        await provider.close('test cleanup')
      }
    }, 30_000)

    test(
      'generateText replies with the literal "ok"',
      async () => {
        const provider = newProvider(agent, `gen-${agent}-${Date.now()}`)
        try {
          const { text, finishReason } = await generateText({
            model: provider.languageModel(),
            prompt:
              'Reply with exactly the lowercase word: ok\nDo not include any other words, punctuation, or formatting.',
            stopWhen: stepCountIs(1),
          })
          expect(text.toLowerCase()).toContain('ok')
          expect(['stop', 'tool-calls', 'unknown']).toContain(finishReason)
        } finally {
          await provider.close('test cleanup')
        }
      },
      TEST_TIMEOUT_MS,
    )

    test(
      'streamText delivers a multi-line response incrementally',
      async () => {
        const provider = newProvider(agent, `stream-${agent}-${Date.now()}`)
        try {
          const result = streamText({
            model: provider.languageModel(),
            prompt:
              'Output the numbers 1, 2, 3, 4, and 5, each on its own line, with no other text.',
            stopWhen: stepCountIs(1),
          })

          let chunkCount = 0
          let full = ''
          for await (const chunk of result.textStream) {
            chunkCount += 1
            full += chunk
          }

          for (const n of ['1', '2', '3', '4', '5']) {
            expect(full).toContain(n)
          }
          expect(chunkCount).toBeGreaterThan(0)
        } finally {
          await provider.close('test cleanup')
        }
      },
      TEST_TIMEOUT_MS,
    )

    test(
      'persistent session retains context across two turns',
      async () => {
        const sessionKey = `persist-${agent}-${Date.now()}`
        const provider = newProvider(agent, sessionKey)
        try {
          const model = provider.languageModel()

          await generateText({
            model,
            prompt:
              'Remember this: my favorite fruit is mangosteen. Acknowledge with exactly the word: noted',
            stopWhen: stepCountIs(1),
          })

          const { text } = await generateText({
            model,
            prompt:
              'What is my favorite fruit? Reply with only the fruit name in lowercase, no other words.',
            stopWhen: stepCountIs(1),
          })

          expect(text.toLowerCase()).toContain('mangosteen')
        } finally {
          await provider.close('test cleanup')
        }
      },
      2 * TEST_TIMEOUT_MS,
    )

    test(
      'generateObject produces structured JSON matching a schema',
      async () => {
        const provider = newProvider(agent, `json-${agent}-${Date.now()}`)
        try {
          const { object } = await generateObject({
            model: provider.languageModel(),
            schema: z.object({
              fruit: z.string(),
              color: z.string(),
            }),
            prompt:
              'Pick a single fruit and the color most associated with it. Return only the JSON object.',
          })

          expect(typeof object.fruit).toBe('string')
          expect(object.fruit.length).toBeGreaterThan(0)
          expect(typeof object.color).toBe('string')
          expect(object.color.length).toBeGreaterThan(0)
        } finally {
          await provider.close('test cleanup')
        }
      },
      TEST_TIMEOUT_MS,
    )
  })
}
