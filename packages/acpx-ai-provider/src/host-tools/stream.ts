import type {
  LanguageModelV2CallWarning,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider'

/**
 * Run `onDone` when the stream finishes for any reason, and emit a
 * leading `stream-start` when, and only when, there are warnings to
 * deliver.
 *
 * Conditional on purpose. `stream-start` is the V2 channel for call
 * warnings, but adding it unconditionally would change the part sequence
 * every existing consumer sees, which is a breaking change this feature
 * has no reason to make. No warnings, no new part.
 *
 * `onDone` is where the turn's abort controller is released: a host tool
 * call left pending after the turn ended would otherwise hold host code
 * open with nothing left to answer it.
 */
export function prependStreamStart(
  stream: ReadableStream<LanguageModelV2StreamPart>,
  warnings: LanguageModelV2CallWarning[],
  onDone: () => void,
): ReadableStream<LanguageModelV2StreamPart> {
  const reader = stream.getReader()
  let started = false
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    onDone()
  }
  return new ReadableStream<LanguageModelV2StreamPart>({
    async pull(controller) {
      if (!started) {
        started = true
        if (warnings.length > 0) {
          controller.enqueue({ type: 'stream-start', warnings })
          return
        }
      }
      try {
        const { done, value } = await reader.read()
        if (done) {
          finish()
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (error) {
        finish()
        controller.error(error)
      }
    },
    async cancel(reason) {
      finish()
      await reader.cancel(reason)
    },
  })
}
