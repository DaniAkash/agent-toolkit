/**
 * End-to-end contract for host tools against a real codex agent.
 *
 * NOT run in CI: spawns a real codex-acp process and takes a prompt turn.
 * The unit suites cover the protocol (`host-tools-handler.test.ts`), the
 * listener (`host-tools-serve.test.ts`) and the session wiring
 * (`host-tools-wiring.test.ts`) against mocks. This file covers the one
 * question none of those can answer: does a real agent discover the
 * loopback server and call it, with arguments the host can use.
 *
 * It is the spike that justified building the feature, kept as a test.
 *
 * How to run:
 *
 *   SMOKE_AGENTS=codex bun test test/e2e/host-tools.test.ts
 *
 * Prerequisites: codex CLI authenticated locally. No API key is needed or
 * wanted; codex uses its own local auth.
 *
 * Why codex: it advertises `mcpCapabilities.http: true` and
 * `sessionCapabilities.systemPrompt: false`, which is the harder of the
 * two built-in agents for this feature. With no system prompt available,
 * the tool description is the only channel that reaches the model, so a
 * pass here exercises the case that depends on `tools/list` quality.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateText, isStepCount } from 'ai'
import type { AcpxHostTool } from '../../src/index.ts'
import { createAcpxProvider } from '../../src/index.ts'

const REQUESTED = (process.env.SMOKE_AGENTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const shouldRun =
  REQUESTED.includes('all') ||
  REQUESTED.includes('codex') ||
  process.env.RUN_E2E_AGENT_TESTS === '1'

const TURN_TIMEOUT_MS = 120_000
const TEST_TIMEOUT_MS = 2 * TURN_TIMEOUT_MS

interface Invocation {
  name: string
  input: Record<string, unknown>
  sawAbortSignal: boolean
}

describe.skipIf(!shouldRun)('e2e: host tools over MCP (codex)', () => {
  test(
    'the agent discovers and calls a host tool with typed arguments',
    async () => {
      const calls: Invocation[] = []
      const recordAnswer: AcpxHostTool = {
        description:
          'Report the final answer back to the host application. Call this ' +
          'exactly once when you know the answer.',
        inputSchema: {
          type: 'object',
          properties: {
            answer: {
              type: 'string',
              description: 'The answer, as text.',
            },
          },
          required: ['answer'],
          additionalProperties: false,
        },
        execute: (input, context) => {
          calls.push({
            name: 'record_answer',
            input,
            sawAbortSignal: context.abortSignal instanceof AbortSignal,
          })
          return 'recorded'
        },
      }

      const cwd = await mkdtemp(join(tmpdir(), 'acpx-host-tools-'))
      const provider = createAcpxProvider({
        agent: 'codex',
        cwd,
        sessionKey: `host-tools-${Date.now()}`,
        turnTimeoutMs: TURN_TIMEOUT_MS,
        hostTools: { tools: { record_answer: recordAnswer } },
      })

      let text = ''
      try {
        const result = await generateText({
          model: provider.languageModel(),
          stopWhen: isStepCount(4),
          prompt:
            'What is 17 + 25? Do not answer in prose. Report the result ' +
            'ONLY by calling the record_answer tool.',
        })
        text = result.text
      } finally {
        await provider.close('test cleanup')
        await rm(cwd, { recursive: true, force: true })
      }

      // The tool ran in this process, which is the whole point: the host
      // function was invoked, not merely described in the stream.
      expect(calls).toHaveLength(1)
      const call = calls[0]
      expect(call?.name).toBe('record_answer')

      // Real parsed arguments, out of band. The stream collapses input and
      // result into one text field, so this is the only place the host can
      // read a structured value.
      expect(call?.input).toBeDefined()
      expect(Object.hasOwn(call?.input ?? {}, 'answer')).toBe(true)
      expect(String(call?.input.answer)).toContain('42')

      // Cancelling the turn has to be able to reach a pending tool.
      expect(call?.sawAbortSignal).toBe(true)

      // Not asserted as empty: whether the agent also narrates is its own
      // business and varies per model. What matters is that it reported
      // through the tool at all.
      expect(typeof text).toBe('string')
    },
    TEST_TIMEOUT_MS,
  )

  test(
    'a host tool that rejects does not take the turn down',
    async () => {
      // An execute() that throws becomes an MCP tool error the agent can
      // read, rather than a thrown turn. The agent should still finish.
      let attempts = 0
      const brokenTool: AcpxHostTool = {
        description: 'Store a value. Call this once with any text.',
        inputSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
        },
        execute: () => {
          attempts += 1
          throw new Error('the host store is unavailable')
        },
      }

      const cwd = await mkdtemp(join(tmpdir(), 'acpx-host-tools-fail-'))
      const provider = createAcpxProvider({
        agent: 'codex',
        cwd,
        sessionKey: `host-tools-fail-${Date.now()}`,
        turnTimeoutMs: TURN_TIMEOUT_MS,
        hostTools: { tools: { store_value: brokenTool } },
      })

      let finished = false
      let reportedToolNames: Array<{ name: string; meta?: unknown }> = []
      try {
        const result = await generateText({
          model: provider.languageModel(),
          stopWhen: isStepCount(3),
          // The argument name is spelled out deliberately. An earlier
          // wording ("with the text \"hello\"") made codex send
          // `{ text: 'hello' }` against a schema declaring `value`, so the
          // validator rejected the call and `execute` never ran: the right
          // behaviour, but it meant this test was measuring the validator
          // rather than the error path it is here for.
          prompt:
            'Call the store_value tool once, passing the argument ' +
            '`value` set to the string "hello". Call it now, before you ' +
            'say anything. If the call returns an error, reply with "the ' +
            'tool failed" and stop.',
        })
        finished = true
        reportedToolNames = result.steps.flatMap((st) =>
          st.content
            .filter((c) => c.type === 'tool-call')
            .map((c) => ({ name: c.toolName, meta: c.providerMetadata })),
        )
      } finally {
        await provider.close('test cleanup')
        await rm(cwd, { recursive: true, force: true })
      }

      expect(attempts).toBeGreaterThan(0)
      // The turn completed rather than throwing out of generateText.
      expect(finished).toBe(true)

      // The agent reported the call under its own namespaced name. Checked
      // loosely here because the name is the agent's to choose; the exact
      // forms, and the `providerMetadata` marker that lets a consumer spot
      // them, are pinned deterministically in
      // test/integration/host-tool-metadata.test.ts. The marker cannot be
      // asserted through `generateText().steps`: the AI SDK reshapes a
      // call for a tool it was not given into a dynamic, invalid one and
      // `providerMetadata` does not survive that.
      expect(
        reportedToolNames.some((t) => t.name.includes('store_value')),
      ).toBe(true)
    },
    TEST_TIMEOUT_MS,
  )
})
