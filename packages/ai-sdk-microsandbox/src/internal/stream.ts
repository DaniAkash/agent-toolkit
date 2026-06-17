import type { ExecEvent } from 'microsandbox'

/**
 * Drain a `ReadableStream<Uint8Array>` into a single byte buffer. Honors
 * `abortSignal` between chunks — if abort fires mid-drain we cancel the
 * source stream and throw `signal.reason`, rather than waiting for the
 * entire upload to finish.
 */
export async function collectStream(
  stream: ReadableStream<Uint8Array>,
  abortSignal?: AbortSignal,
): Promise<Uint8Array> {
  abortSignal?.throwIfAborted()
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      abortSignal?.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        total += value.byteLength
      }
    }
  } catch (error) {
    // Best-effort: tell the source we're not reading anymore so it can release
    // resources. Swallow cancel errors; the original error is what matters.
    reader.cancel(error).catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Wrap raw bytes in a one-shot `ReadableStream<Uint8Array>`. */
export function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

/**
 * Demultiplex a microsandbox `ExecHandle`'s combined event stream into two
 * independent `ReadableStream<Uint8Array>`s — one for stdout, one for stderr.
 * Side effects from the source iterator are consumed exactly once; the
 * returned streams close together when an `exited` event arrives or when the
 * source iterator finishes.
 */
export function demuxExecStreams(
  source: AsyncIterable<ExecEvent>,
  onPid?: (pid: number) => void,
): { stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array> } {
  let stdoutController: ReadableStreamDefaultController<Uint8Array> | undefined
  let stderrController: ReadableStreamDefaultController<Uint8Array> | undefined
  let pumping = false

  const stdout = new ReadableStream<Uint8Array>({
    start(c) {
      stdoutController = c
      pump()
    },
  })
  const stderr = new ReadableStream<Uint8Array>({
    start(c) {
      stderrController = c
    },
  })

  async function pump() {
    if (pumping) return
    pumping = true
    try {
      for await (const event of source) {
        switch (event.kind) {
          case 'started':
            onPid?.(event.pid)
            break
          case 'stdout':
            stdoutController?.enqueue(event.data)
            break
          case 'stderr':
            stderrController?.enqueue(event.data)
            break
          case 'exited':
            // Source iterator will terminate after this event; fall through.
            break
        }
      }
      stdoutController?.close()
      stderrController?.close()
    } catch (error) {
      stdoutController?.error(error)
      stderrController?.error(error)
    }
  }

  return { stdout, stderr }
}
