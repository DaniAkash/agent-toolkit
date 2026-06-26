import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { HarnessV1CallWarning } from '@ai-sdk/harness'
import type { BridgeTurn } from '@ai-sdk/harness/bridge'
import {
  type AcpRuntime,
  type AcpRuntimeEvent,
  type AcpRuntimeOptions,
  type AcpRuntimeTurnResult,
  createAcpRuntime,
  createAgentRegistry,
  createFileSessionStore,
} from 'acpx/runtime'
import {
  type AcpxBridgeStartMessage,
  acpxBridgeStartMessageSchema,
} from '../acpx-bridge-protocol.ts'
import { AcpxEventTranslator } from '../acpx-event-translator.ts'
import { harnessPermissionModeToAcpx } from '../acpx-permission.ts'
import { toRuntimeMcpServers } from './mcp-servers.ts'
import { createPermissionHandler } from './permission-handler.ts'

/**
 * If the underlying runtime emits an `error` event and then goes silent
 * (no further events, no clean `result`), force-finish the turn after
 * this much wall-clock time so the host doesn't hang forever.
 *
 * Bounded by reality: acpx's runtime SHOULD eventually reject the
 * `result` promise on terminal failures, but in practice some adapters
 * just stop emitting and leave the iterator open. The watchdog is the
 * safety net.
 */
const SILENT_AFTER_ERROR_TIMEOUT_MS = 10_000

export interface RunAcpxTurnOptions {
  /** The working directory the bridge was launched against. */
  readonly workdir: string
  /**
   * Optional runtime override. When omitted, a fresh acpx runtime is built
   * from the start frame. Tests inject a `MockAcpRuntime` here.
   */
  readonly runtime?: AcpRuntime
  /**
   * Override the silent-after-error watchdog. Mostly for tests.
   */
  readonly silentAfterErrorTimeoutMs?: number
}

/**
 * Drive a single prompt turn end-to-end inside the sandbox bridge process.
 *
 * Runtime construction is intentionally per-turn: acpx persists session
 * state to disk via `stateDir` + `sessionKey`, so reuse across turns happens
 * through the file system rather than an in-memory runtime instance. That
 * keeps per-turn config (permission mode, model) honoured without a
 * long-lived runtime carrying stale options forward.
 */
export async function runAcpxTurn(
  start: AcpxBridgeStartMessage,
  turn: BridgeTurn,
  options: RunAcpxTurnOptions,
): Promise<void> {
  const parsed = acpxBridgeStartMessageSchema.parse(start)
  const runtime = options.runtime ?? createAcpxRuntime(parsed, options, turn)

  const handle = await runtime.ensureSession({
    sessionKey: parsed.sessionKey,
    agent: parsed.agent,
    mode: 'persistent',
    cwd: parsed.cwd,
    sessionOptions: parsed.model ? { model: parsed.model } : undefined,
  })

  const translator = new AcpxEventTranslator({
    agent: parsed.agent,
    generateId: () => randomUUID(),
    emit: (part) => turn.emit(part),
  })
  translator.start({
    warnings: buildStreamStartWarnings(parsed),
  })

  const acpTurn = runtime.startTurn({
    handle,
    text: parsed.prompt,
    mode: 'prompt',
    requestId: randomUUID(),
    signal: turn.abortSignal,
  })

  const silentTimeoutMs =
    options.silentAfterErrorTimeoutMs ?? SILENT_AFTER_ERROR_TIMEOUT_MS

  try {
    const outcome = await drainTurnWithWatchdog(acpTurn, {
      translate: (e) => translator.translate(e),
      silentTimeoutMs,
    })
    translator.flush()
    if (outcome.kind === 'completed') {
      translator.finish(outcome.result)
    } else {
      // Watchdog tripped after an error event and no follow-up activity.
      // Cancel acpx side and synthesize a failed finish so the host's
      // stream drains cleanly instead of hanging.
      try {
        await acpTurn.cancel({
          reason: 'watchdog: agent went silent after error',
        })
      } catch {
        /* idempotent */
      }
      translator.finish({
        status: 'failed',
        error: {
          message:
            'acpx-ai-harness: agent emitted an error and then stopped responding within ' +
            `${silentTimeoutMs}ms. Treating the turn as failed.`,
          code: 'agent_silent_after_error',
        },
      })
    }
  } catch (err) {
    turn.emit({ type: 'error', error: serialiseError(err) })
    translator.finish({
      status: 'failed',
      error: {
        message: err instanceof Error ? err.message : String(err),
        code: 'turn_failed',
      },
    })
  }
}

type TurnOutcome =
  | { kind: 'completed'; result: AcpRuntimeTurnResult }
  | { kind: 'silent-after-error' }

/**
 * Drain `acpTurn.events` while watching for the "agent emitted an error
 * then went silent" failure mode. On every event the watchdog timer
 * resets. Once we've seen at least one `error` event, the timer becomes
 * eligible to fire; if it does, we abandon the iterator.
 *
 * On a clean finish (iterator drains + result resolves) we return
 * `{ kind: 'completed' }`. On watchdog fire we return
 * `{ kind: 'silent-after-error' }`.
 */
async function drainTurnWithWatchdog(
  acpTurn: {
    events: AsyncIterable<AcpRuntimeEvent>
    result: Promise<AcpRuntimeTurnResult>
  },
  opts: {
    translate: (event: AcpRuntimeEvent) => void
    silentTimeoutMs: number
  },
): Promise<TurnOutcome> {
  const iterator = acpTurn.events[Symbol.asyncIterator]()
  const watchdogState: { reschedule?: () => void } = {}
  let sawError = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const watchdog = new Promise<'silent-after-error'>((resolve) => {
    watchdogState.reschedule = () => {
      if (timer) clearTimeout(timer)
      if (!sawError) return
      timer = setTimeout(
        () => resolve('silent-after-error'),
        opts.silentTimeoutMs,
      )
    }
  })

  while (true) {
    const step = await Promise.race([
      iterator.next().then((r) => ({ tag: 'next' as const, r })),
      watchdog.then((reason) => ({ tag: reason })),
    ])
    if (step.tag === 'silent-after-error') {
      if (timer) clearTimeout(timer)
      try {
        await iterator.return?.()
      } catch {
        /* idempotent */
      }
      return { kind: 'silent-after-error' }
    }
    const { value, done } = step.r
    if (done) break
    opts.translate(value)
    if (value.type === 'error') sawError = true
    watchdogState.reschedule?.()
  }
  if (timer) clearTimeout(timer)
  const result = await acpTurn.result
  return { kind: 'completed', result }
}

function createAcpxRuntime(
  start: AcpxBridgeStartMessage,
  options: RunAcpxTurnOptions,
  turn: BridgeTurn,
): AcpRuntime {
  const stateDir = start.stateDir ?? path.join(os.homedir(), '.acpx')
  const runtimeOptions: AcpRuntimeOptions = {
    cwd: options.workdir,
    sessionStore: createFileSessionStore({ stateDir }),
    agentRegistry: createAgentRegistry({}),
    permissionMode: harnessPermissionModeToAcpx(start.permissionMode),
    mcpServers: toRuntimeMcpServers(start.mcpServers),
    onPermissionRequest: createPermissionHandler(turn),
  }
  return createAcpRuntime(runtimeOptions)
}

function buildStreamStartWarnings(
  start: AcpxBridgeStartMessage,
): ReadonlyArray<HarnessV1CallWarning> | undefined {
  if (!start.tools || start.tools.length === 0) return undefined
  return start.tools.map((tool) => ({
    type: 'unsupported-tool' as const,
    tool: tool.name,
    details:
      'acpx-ai-harness does not yet forward host AI SDK tools to the underlying ACP agent. ' +
      'Use stdio / http / sse MCP servers via the `mcpServers` start-frame field instead.',
  }))
}

function serialiseError(err: unknown): {
  message: string
  code?: string
  stack?: string
} {
  if (err instanceof Error) {
    return {
      message: err.message,
      code: (err as { code?: string }).code,
      stack: err.stack,
    }
  }
  return { message: String(err) }
}
