import type { Experimental_SandboxProcess } from '@ai-sdk/provider-utils'
import type { ExecHandle } from 'microsandbox'
import { demuxExecStreams } from './internal/stream.ts'

/**
 * Adapt microsandbox's `ExecHandle` to the harness's `SandboxProcess` shape.
 * Demultiplexes the combined event stream into separate stdout/stderr
 * ReadableStreams and wires the abort signal to `handle.kill()` — the one
 * code path where signal propagation is real rather than best-effort.
 */
export function createSandboxProcess(
  handle: ExecHandle,
  abortSignal: AbortSignal | undefined,
): Experimental_SandboxProcess {
  let pid: number | undefined
  const { stdout, stderr } = demuxExecStreams(handle, (resolvedPid) => {
    pid = resolvedPid
  })
  if (abortSignal && !abortSignal.aborted) {
    abortSignal.addEventListener(
      'abort',
      () => {
        handle.kill().catch(() => {
          // Best-effort kill — the handle may already be dead.
        })
      },
      { once: true },
    )
  } else if (abortSignal?.aborted) {
    handle.kill().catch(() => {})
  }
  return {
    get pid() {
      return pid
    },
    stdout,
    stderr,
    async wait() {
      const result = await handle.wait()
      return { exitCode: result.code }
    },
    async kill() {
      await handle.kill()
    },
  }
}
