import type { HarnessV1CallWarning, HarnessV1StreamPart } from '@ai-sdk/harness'
import type {
  LanguageModelV4FinishReason,
  LanguageModelV4Usage,
} from '@ai-sdk/provider'
import type { AcpRuntimeEvent, AcpRuntimeTurnResult } from 'acpx/runtime'
import { toCommonToolName } from './acpx-native-tool-names.ts'

type TextStream = 'output' | 'thought'
type BlockKind = TextStream | null

interface ToolCallState {
  nativeName: string
  emittedText: string
  emitted: boolean
}

export interface AcpxEventTranslatorOptions {
  /** ACP agent id, used for native -> common tool name resolution. */
  readonly agent: string
  /** Block-id generator. The harness needs stable ids per text / reasoning block. */
  readonly generateId: () => string
  /** Sink that receives every emitted harness stream part. */
  readonly emit: (part: HarnessV1StreamPart) => void
}

const EMPTY_USAGE: LanguageModelV4Usage = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: undefined,
    text: undefined,
    reasoning: undefined,
  },
}

const STOP_REASON_MAP: Record<string, LanguageModelV4FinishReason['unified']> =
  {
    end_turn: 'stop',
    stop_sequence: 'stop',
    max_tokens: 'length',
    tool_calls: 'tool-calls',
    tool_use: 'tool-calls',
  }

/**
 * Translates `AcpRuntimeEvent`s emitted by acpx into the harness's
 * `HarnessV1StreamPart` events.
 *
 * Lifecycle:
 *   1. `start({ modelId? })` once at the top of a turn to emit `stream-start`.
 *   2. `translate(event)` for each runtime event.
 *   3. `flush()` once the runtime's event iterator drains, to close any open
 *      text / reasoning block.
 *   4. `finish(result)` to emit the terminal `finish` part (and an `error`
 *      part first when the turn failed).
 */
export class AcpxEventTranslator {
  private readonly agent: string
  private readonly generateId: () => string
  private readonly emit: (part: HarnessV1StreamPart) => void
  private started = false
  private currentBlock: BlockKind = null
  private currentBlockId: string | null = null
  private readonly toolCalls = new Map<string, ToolCallState>()
  private accumulatedTotalTokens: number | undefined
  private accumulatedSize: number | undefined

  constructor(opts: AcpxEventTranslatorOptions) {
    this.agent = opts.agent
    this.generateId = opts.generateId
    this.emit = opts.emit
  }

  start(
    options: {
      modelId?: string
      warnings?: ReadonlyArray<HarnessV1CallWarning>
    } = {},
  ): void {
    if (this.started) return
    this.started = true
    this.emit({
      type: 'stream-start',
      ...(options.modelId ? { modelId: options.modelId } : {}),
      ...(options.warnings && options.warnings.length > 0
        ? { warnings: options.warnings }
        : {}),
    })
  }

  translate(event: AcpRuntimeEvent): void {
    switch (event.type) {
      case 'text_delta':
        this.handleTextDelta(event)
        return
      case 'tool_call':
        this.handleToolCall(event)
        return
      case 'status':
        this.handleStatus(event)
        return
      case 'error':
        this.handleError(event)
        return
      case 'done':
        return
    }
  }

  flush(): void {
    this.closeCurrentBlock()
    for (const [id, state] of this.toolCalls) {
      if (!state.emitted) {
        this.emitToolCallAndResult(id, state, false)
      }
    }
  }

  finish(result: AcpRuntimeTurnResult): void {
    if (result.status === 'failed') {
      this.emit({ type: 'error', error: result.error })
    }
    const finishReason = mapFinishReason(result)
    const totalUsage = this.accumulatedUsage()
    this.emit({ type: 'finish', finishReason, totalUsage })
  }

  private accumulatedUsage(): LanguageModelV4Usage {
    if (
      this.accumulatedTotalTokens === undefined &&
      this.accumulatedSize === undefined
    ) {
      return EMPTY_USAGE
    }
    return {
      inputTokens: {
        total: this.accumulatedTotalTokens,
        noCache: undefined,
        cacheRead: this.accumulatedSize,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: undefined,
        text: undefined,
        reasoning: undefined,
      },
    }
  }

  private handleTextDelta(
    event: Extract<AcpRuntimeEvent, { type: 'text_delta' }>,
  ): void {
    const target: TextStream = event.stream === 'thought' ? 'thought' : 'output'

    if (this.currentBlock !== target) {
      this.closeCurrentBlock()
      const id = this.generateId()
      this.emit({
        type: target === 'thought' ? 'reasoning-start' : 'text-start',
        id,
      })
      this.currentBlock = target
      this.currentBlockId = id
    }

    if (event.text.length > 0 && this.currentBlockId) {
      this.emit({
        type: target === 'thought' ? 'reasoning-delta' : 'text-delta',
        id: this.currentBlockId,
        delta: event.text,
      })
    }
  }

  private closeCurrentBlock(): void {
    if (!this.currentBlock || !this.currentBlockId) return
    this.emit({
      type: this.currentBlock === 'thought' ? 'reasoning-end' : 'text-end',
      id: this.currentBlockId,
    })
    this.currentBlock = null
    this.currentBlockId = null
  }

  private handleToolCall(
    event: Extract<AcpRuntimeEvent, { type: 'tool_call' }>,
  ): void {
    const callId = event.toolCallId
    if (!callId) return

    this.closeCurrentBlock()

    let state = this.toolCalls.get(callId)
    if (!state) {
      const nativeName = (event.title?.trim() || 'tool').trim()
      state = { nativeName, emittedText: '', emitted: false }
      this.toolCalls.set(callId, state)
    }

    if (event.text) {
      state.emittedText = event.text
    }

    if (isTerminalToolStatus(event.status)) {
      this.emitToolCallAndResult(callId, state, event.status === 'failed')
    }
  }

  private emitToolCallAndResult(
    callId: string,
    state: ToolCallState,
    failed: boolean,
  ): void {
    if (state.emitted) return
    const commonOrNative = toCommonToolName(this.agent, state.nativeName)
    this.emit({
      type: 'tool-call',
      toolCallId: callId,
      toolName: commonOrNative,
      input: state.emittedText,
      providerExecuted: true,
      ...(commonOrNative !== state.nativeName
        ? { nativeName: state.nativeName }
        : {}),
    })
    this.emit({
      type: 'tool-result',
      toolCallId: callId,
      toolName: commonOrNative,
      result: state.emittedText,
      ...(failed ? { isError: true } : {}),
    })
    state.emitted = true
    this.toolCalls.delete(callId)
  }

  private handleStatus(
    event: Extract<AcpRuntimeEvent, { type: 'status' }>,
  ): void {
    if (event.tag === 'usage_update') {
      if (event.used !== undefined) this.accumulatedTotalTokens = event.used
      if (event.size !== undefined) this.accumulatedSize = event.size
      return
    }
    if (event.tag === 'plan') {
      const trimmed = event.text.trim()
      if (trimmed.length === 0) return
      const id = this.generateId()
      this.emit({ type: 'reasoning-start', id })
      this.emit({ type: 'reasoning-delta', id, delta: `[Plan] ${trimmed}` })
      this.emit({ type: 'reasoning-end', id })
    }
  }

  private handleError(
    event: Extract<AcpRuntimeEvent, { type: 'error' }>,
  ): void {
    this.emit({
      type: 'error',
      error: {
        message: event.message,
        code: event.code,
        retryable: event.retryable,
      },
    })
  }
}

function isTerminalToolStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed'
}

function mapFinishReason(
  result: AcpRuntimeTurnResult,
): LanguageModelV4FinishReason {
  if (result.status === 'cancelled')
    return { unified: 'other', raw: 'cancelled' }
  if (result.status === 'failed') return { unified: 'error', raw: 'failed' }
  const raw = result.stopReason
  if (!raw) return { unified: 'stop', raw: 'stop' }
  const unified = STOP_REASON_MAP[raw] ?? 'other'
  return { unified, raw }
}
