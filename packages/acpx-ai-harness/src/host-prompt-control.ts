import type {
  HarnessV1PromptControl,
  HarnessV1StreamPart,
} from '@ai-sdk/harness'
import type { AcpxChannel } from './sandbox-channel.ts'

const STREAM_PART_TYPES = [
  'stream-start',
  'text-start',
  'text-delta',
  'text-end',
  'reasoning-start',
  'reasoning-delta',
  'reasoning-end',
  'tool-call',
  'tool-approval-request',
  'tool-result',
  'finish-step',
  'finish',
  'file-change',
  'compaction',
  'error',
  'raw',
] as const

export interface WirePromptControlInput {
  readonly channel: AcpxChannel
  readonly emit: (part: HarnessV1StreamPart) => void
  readonly abortSignal?: AbortSignal
}

/**
 * Build a HarnessV1PromptControl wired against an open channel. Subscribes to
 * every harness stream part the bridge can emit, forwards each to `emit`, and
 * resolves `done` on `finish`. An aborted bridge turn rejects `done` and sends
 * an `abort` frame to the bridge.
 */
export function wirePromptControl(
  input: WirePromptControlInput,
): HarnessV1PromptControl {
  let resolveDone!: () => void
  let rejectDone!: (err: unknown) => void
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  const unsubs: Array<() => void> = []

  const cleanup = () => {
    for (const u of unsubs) {
      u()
    }
  }

  for (const type of STREAM_PART_TYPES) {
    unsubs.push(
      input.channel.on(type, (event) => {
        input.emit(event as HarnessV1StreamPart)
        if (event.type === 'finish') {
          resolveDone()
          cleanup()
        }
      }),
    )
  }

  if (input.abortSignal) {
    const onAbort = () => {
      try {
        input.channel.send({ type: 'abort' })
      } catch {
        /* socket may already be gone */
      }
      rejectDone(new Error('aborted'))
      cleanup()
    }
    if (input.abortSignal.aborted) onAbort()
    else input.abortSignal.addEventListener('abort', onAbort, { once: true })
  }

  return {
    submitToolResult: async ({ toolCallId, output, isError }) => {
      input.channel.send({
        type: 'tool-result',
        toolCallId,
        output,
        ...(isError !== undefined ? { isError } : {}),
      })
    },
    submitToolApproval: async ({ approvalId, approved, reason }) => {
      input.channel.send({
        type: 'tool-approval-response',
        approvalId,
        approved,
        ...(reason !== undefined ? { reason } : {}),
      })
    },
    submitUserMessage: async (text) => {
      input.channel.send({ type: 'user-message', text })
    },
    done,
  }
}
