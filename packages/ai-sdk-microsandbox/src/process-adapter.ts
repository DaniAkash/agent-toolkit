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

  // The SDK's `handle.wait()` and `handle.kill()` don't compose: when
  // `wait()` is awaited first, a subsequent `kill()` does not unblock
  // it (verified empirically against microsandbox 0.5.7 — `kill()`
  // returns instantly but `wait()` keeps blocking until the natural
  // exit). We work around that by resolving `wait()` ourselves when
  // abort fires, with the canonical SIGKILL exit code (128 + 9).
  let resolveAborted: ((value: { exitCode: number }) => void) | undefined
  const aborted = new Promise<{ exitCode: number }>((res) => {
    resolveAborted = res
  })

  const cancelProcess = (): void => {
    // SIGKILL via signal(9) when available; fall back to kill() for
    // SDK revs or test doubles that don't expose signal().
    const sig = (handle as { signal?: (n: number) => Promise<void> }).signal
    if (typeof sig === 'function') {
      sig.call(handle, 9).catch(() => handle.kill().catch(() => undefined))
    } else {
      handle.kill().catch(() => undefined)
    }
    resolveAborted?.({ exitCode: 137 })
  }
  if (abortSignal && !abortSignal.aborted) {
    abortSignal.addEventListener('abort', cancelProcess, { once: true })
  } else if (abortSignal?.aborted) {
    cancelProcess()
  }
  return {
    get pid() {
      return pid
    },
    stdout,
    stderr,
    async wait() {
      return await Promise.race([
        handle.wait().then((r) => ({ exitCode: r.code })),
        aborted,
      ])
    },
    async kill() {
      await handle.kill()
    },
  }
}
