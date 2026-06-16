import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { HarnessV1CallWarning } from '@ai-sdk/harness'
import type { BridgeTurn } from '@ai-sdk/harness/bridge'
import {
  type AcpRuntime,
  type AcpRuntimeOptions,
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

export interface RunAcpxTurnOptions {
  /** The working directory the bridge was launched against. */
  readonly workdir: string
  /**
   * Optional runtime override. When omitted, a fresh acpx runtime is built
   * from the start frame. Tests inject a `MockAcpRuntime` here.
   */
  readonly runtime?: AcpRuntime
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
  const runtime = options.runtime ?? createAcpxRuntime(parsed, options)

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

  try {
    for await (const event of acpTurn.events) {
      translator.translate(event)
    }
    translator.flush()
    const result = await acpTurn.result
    translator.finish(result)
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

function createAcpxRuntime(
  start: AcpxBridgeStartMessage,
  options: RunAcpxTurnOptions,
): AcpRuntime {
  const stateDir = start.stateDir ?? path.join(os.homedir(), '.acpx')
  const runtimeOptions: AcpRuntimeOptions = {
    cwd: options.workdir,
    sessionStore: createFileSessionStore({ stateDir }),
    agentRegistry: createAgentRegistry({}),
    permissionMode: harnessPermissionModeToAcpx(start.permissionMode),
    mcpServers: toRuntimeMcpServers(start.mcpServers),
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
      'Use stdio / http / sse MCP servers via the `mcpServers` start-frame field instead. ' +
      'See https://github.com/DaniAkash/acpx/issues for the tracking issue.',
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
