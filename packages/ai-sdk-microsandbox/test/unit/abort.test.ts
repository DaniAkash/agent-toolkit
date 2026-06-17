import { describe, expect, test } from 'bun:test'
import { withAbort } from '../../src/abort.ts'

describe('withAbort', () => {
  test('returns the wrapped value when no signal is provided', async () => {
    const result = await withAbort(Promise.resolve(42))
    expect(result).toBe(42)
  })

  test('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('pre-aborted'))
    await expect(withAbort(Promise.resolve(1), controller.signal)).rejects.toThrow(
      'pre-aborted',
    )
  })

  test('rejects with signal.reason when abort fires during a pending promise', async () => {
    const controller = new AbortController()
    const reason = new Error('aborted mid-flight')
    const pending = new Promise<number>((resolve) => setTimeout(() => resolve(7), 50))
    setTimeout(() => controller.abort(reason), 10)
    await expect(withAbort(pending, controller.signal)).rejects.toThrow(
      'aborted mid-flight',
    )
  })

  test('resolves cleanly when the promise settles before abort fires', async () => {
    const controller = new AbortController()
    const result = await withAbort(Promise.resolve('done'), controller.signal)
    expect(result).toBe('done')
    // Abort after settle — should not affect anything (already resolved).
    controller.abort()
  })

  test('propagates the original rejection when the promise rejects before abort', async () => {
    const controller = new AbortController()
    const original = new Error('original failure')
    await expect(withAbort(Promise.reject(original), controller.signal)).rejects.toBe(
      original,
    )
  })

  test('removes the abort listener on settle to avoid leaks', async () => {
    const controller = new AbortController()
    let removed = false
    const originalRemove = controller.signal.removeEventListener.bind(controller.signal)
    controller.signal.removeEventListener = (type, listener, options) => {
      if (type === 'abort') removed = true
      return originalRemove(type, listener, options)
    }
    await withAbort(Promise.resolve(1), controller.signal)
    expect(removed).toBe(true)
  })
})
