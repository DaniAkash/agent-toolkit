/**
 * End-to-end contract test for AcpxProviderSettings.onPermissionRequest
 * against a real codex agent.
 *
 * NOT run in CI — spawns a real codex-acp process, hits the OpenAI API
 * for the prompt turn, and exercises the full ACP permission-request
 * round-trip. The mock-based unit tests in test/unit/provider.test.ts
 * cover the "is the callback wired into AcpRuntimeOptions?" question;
 * this file covers "does the wire-level permission round-trip actually
 * route through the callback and does the agent honour the decision?"
 * — the part the unit harness can't see.
 *
 * How to run:
 *
 *   SMOKE_AGENTS=codex bun test test/e2e/permission-callback.test.ts
 *
 *   # Or as part of the broader smoke battery
 *   SMOKE_AGENTS=all bun test test/e2e
 *
 * Prerequisites: codex CLI authenticated locally. Set
 * ACPX_AUTH_OPENAI_API_KEY or OPENAI_API_KEY before running.
 *
 * Why codex: codex's apply_patch tool is a non-read operation, so
 * `permissionMode: 'approve-reads'` reliably triggers a permission
 * request when we ask it to write a file. Claude has similar tools
 * but codex's behaviour is the one driving PR #17 (the BrowserOS
 * inline-approval flow mentioned in the PR motivation).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AcpPermissionDecision, AcpPermissionRequest } from 'acpx/runtime'
import { generateText, stepCountIs } from 'ai'
import { createAcpxProvider } from '../../src/index.ts'

const REQUESTED = (process.env.SMOKE_AGENTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const ALL_REQUESTED =
  REQUESTED.includes('all') || process.env.RUN_E2E_AGENT_TESTS === '1'
const shouldRun = ALL_REQUESTED || REQUESTED.includes('codex')

const TURN_TIMEOUT_MS = 90_000
const TEST_TIMEOUT_MS = 2 * TURN_TIMEOUT_MS

let scratchDir = ''

beforeAll(async () => {
  if (!shouldRun) return
  scratchDir = await mkdtemp(join(tmpdir(), 'acpx-perm-callback-'))
})

afterAll(async () => {
  if (scratchDir) await rm(scratchDir, { recursive: true, force: true })
})

interface PermissionTrace {
  request: AcpPermissionRequest
  returnedDecision: AcpPermissionDecision | undefined
  at: number
}

function makeProvider(opts: {
  sessionKey: string
  trace: PermissionTrace[]
  decide: (req: AcpPermissionRequest) => AcpPermissionDecision | undefined
}) {
  return createAcpxProvider({
    agent: 'codex',
    cwd: scratchDir,
    sessionKey: opts.sessionKey,
    permissionMode: 'approve-reads',
    nonInteractivePermissions: 'deny',
    turnTimeoutMs: TURN_TIMEOUT_MS,
    onPermissionRequest: async (req) => {
      const decision = opts.decide(req)
      opts.trace.push({
        request: req,
        returnedDecision: decision,
        at: Date.now(),
      })
      return decision
    },
  })
}

describe.skipIf(!shouldRun)(
  'e2e: onPermissionRequest callback contract (codex)',
  () => {
    test(
      'reject_once: callback fires, file is NOT created',
      async () => {
        const fileToCreate = join(scratchDir, 'reject-target.txt')
        const trace: PermissionTrace[] = []
        const provider = makeProvider({
          sessionKey: `perm-reject-${Date.now()}`,
          trace,
          decide: () => ({ outcome: 'reject_once' }),
        })

        try {
          await generateText({
            model: provider.languageModel(),
            stopWhen: stepCountIs(8),
            prompt:
              `Create a file at the absolute path "${fileToCreate}" containing the literal text "hello from acp-probe". ` +
              `Use your file-write tool. If the write is denied, stop immediately and tell me it was denied — do not retry.`,
          })
        } finally {
          await provider.close('test cleanup')
        }

        // Callback was invoked at least once during the turn.
        expect(trace.length).toBeGreaterThan(0)
        const first = trace[0]!
        expect(typeof first.request.sessionId).toBe('string')
        expect(first.request.sessionId.length).toBeGreaterThan(0)
        expect(first.request.raw).toBeDefined()
        // Decision was the one our callback returned.
        expect(first.returnedDecision).toEqual({ outcome: 'reject_once' })

        // The file was NOT created because the write was rejected.
        let createdOnDisk = false
        try {
          await stat(fileToCreate)
          createdOnDisk = true
        } catch {
          /* expected: file should not exist */
        }
        expect(createdOnDisk).toBe(false)
      },
      TEST_TIMEOUT_MS,
    )

    test(
      'allow_once: callback fires, file IS created with the expected content',
      async () => {
        const fileToCreate = join(scratchDir, 'allow-target.txt')
        const expectedContent = 'hello from acp-probe'
        const trace: PermissionTrace[] = []
        const provider = makeProvider({
          sessionKey: `perm-allow-${Date.now()}`,
          trace,
          decide: () => ({ outcome: 'allow_once' }),
        })

        try {
          await generateText({
            model: provider.languageModel(),
            stopWhen: stepCountIs(8),
            prompt:
              `Create a file at the absolute path "${fileToCreate}" containing exactly the literal text "${expectedContent}" (no trailing newline, no quotes). ` +
              `Confirm when done.`,
          })
        } finally {
          await provider.close('test cleanup')
        }

        expect(trace.length).toBeGreaterThan(0)
        expect(trace[0]?.returnedDecision).toEqual({ outcome: 'allow_once' })

        const contents = await readFile(fileToCreate, 'utf8')
        // The agent may strip the trailing newline or add one. Match on
        // substring to avoid being too brittle about agent formatting.
        expect(contents).toContain(expectedContent)
      },
      TEST_TIMEOUT_MS,
    )

    test(
      'undefined return falls through to permissionMode (write denied by approve-reads)',
      async () => {
        const fileToCreate = join(scratchDir, 'fallthrough-target.txt')
        const trace: PermissionTrace[] = []
        const provider = makeProvider({
          sessionKey: `perm-fallthrough-${Date.now()}`,
          trace,
          // Returning undefined hands the decision back to the
          // mode-based resolver. With permissionMode='approve-reads'
          // and nonInteractivePermissions='deny', writes get denied.
          decide: () => undefined,
        })

        try {
          await generateText({
            model: provider.languageModel(),
            stopWhen: stepCountIs(8),
            prompt: `Try to create a file at "${fileToCreate}" with content "fallthrough". If the write is denied, stop and report.`,
          })
        } finally {
          await provider.close('test cleanup')
        }

        // Callback fired but returned undefined — the request shape
        // still has to be correct.
        expect(trace.length).toBeGreaterThan(0)
        expect(trace[0]?.returnedDecision).toBeUndefined()
        expect(trace[0]?.request.sessionId.length).toBeGreaterThan(0)

        // Mode-based resolver denied the write.
        let createdOnDisk = false
        try {
          await stat(fileToCreate)
          createdOnDisk = true
        } catch {
          /* expected */
        }
        expect(createdOnDisk).toBe(false)
      },
      TEST_TIMEOUT_MS,
    )
  },
)
