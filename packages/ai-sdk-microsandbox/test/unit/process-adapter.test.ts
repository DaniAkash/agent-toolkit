import { describe, expect, test } from 'bun:test'
import type { ExecHandle } from 'microsandbox'
import { collectStream } from '../../src/internal/stream.ts'
import { createSandboxProcess } from '../../src/process-adapter.ts'
import { MockExecHandle } from '../helpers/mock-sandbox.ts'

function asExecHandle(mock: MockExecHandle): ExecHandle {
  return mock as unknown as ExecHandle
}

describe('createSandboxProcess', () => {
  test('exposes pid resolved from the started event', async () => {
    const handle = new MockExecHandle({
      events: [
        { kind: 'started', pid: 1234 },
        { kind: 'stdout', data: new Uint8Array([0x6f]) },
        { kind: 'exited', code: 0 },
      ],
    })
    const process = createSandboxProcess(asExecHandle(handle), undefined)
    // Drain so the pump runs.
    await collectStream(process.stdout)
    expect(process.pid).toBe(1234)
  })

  test('demuxes stdout and stderr into separate ReadableStreams', async () => {
    const handle = new MockExecHandle({
      events: [
        { kind: 'started', pid: 1 },
        { kind: 'stdout', data: new TextEncoder().encode('out-1 ') },
        { kind: 'stderr', data: new TextEncoder().encode('err-1 ') },
        { kind: 'stdout', data: new TextEncoder().encode('out-2') },
        { kind: 'exited', code: 0 },
      ],
    })
    const process = createSandboxProcess(asExecHandle(handle), undefined)
    const [stdoutBytes, stderrBytes] = await Promise.all([
      collectStream(process.stdout),
      collectStream(process.stderr),
    ])
    expect(new TextDecoder().decode(stdoutBytes)).toBe('out-1 out-2')
    expect(new TextDecoder().decode(stderrBytes)).toBe('err-1 ')
  })

  test('wait() resolves with exitCode mapped from handle.wait().code', async () => {
    const handle = new MockExecHandle({
      events: [{ kind: 'exited', code: 42 }],
      waitCode: 42,
    })
    const process = createSandboxProcess(asExecHandle(handle), undefined)
    await collectStream(process.stdout)
    const result = await process.wait()
    expect(result).toEqual({ exitCode: 42 })
  })

  test('kill() forwards to handle.kill()', async () => {
    const handle = new MockExecHandle({ events: [] })
    const process = createSandboxProcess(asExecHandle(handle), undefined)
    await process.kill()
    expect(handle.killCalls).toBe(1)
  })

  test('abort signal triggers handle.kill() once', async () => {
    const handle = new MockExecHandle({ events: [] })
    const controller = new AbortController()
    createSandboxProcess(asExecHandle(handle), controller.signal)
    expect(handle.killCalls).toBe(0)
    controller.abort()
    // Wait one microtask so the abort listener runs.
    await Promise.resolve()
    expect(handle.killCalls).toBe(1)
    // Aborting again should not double-kill (listener is once-only).
    controller.abort()
    await Promise.resolve()
    expect(handle.killCalls).toBe(1)
  })

  test('pre-aborted signal kills the handle immediately on construction', async () => {
    const handle = new MockExecHandle({ events: [] })
    const controller = new AbortController()
    controller.abort()
    createSandboxProcess(asExecHandle(handle), controller.signal)
    await Promise.resolve()
    expect(handle.killCalls).toBe(1)
  })
})
