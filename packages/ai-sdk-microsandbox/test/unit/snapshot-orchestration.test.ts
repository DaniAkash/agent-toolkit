import { describe, expect, test } from 'bun:test'
import { _internal } from '../../src/internal/snapshot-orchestration.ts'

const { isSnapshotSourceRunningError } = _internal

describe('isSnapshotSourceRunningError', () => {
  test('matches code === "SnapshotSourceRunning"', () => {
    expect(
      isSnapshotSourceRunningError({ code: 'SnapshotSourceRunning' }),
    ).toBe(true)
  })

  test('matches code === "SOURCE_RUNNING"', () => {
    expect(isSnapshotSourceRunningError({ code: 'SOURCE_RUNNING' })).toBe(true)
  })

  test('matches message containing "source is still running"', () => {
    expect(
      isSnapshotSourceRunningError(
        new Error('snapshot source still running, cannot capture'),
      ),
    ).toBe(true)
  })

  test('matches message containing "sandbox alive"', () => {
    expect(
      isSnapshotSourceRunningError(new Error('sandbox alive when snapshotting')),
    ).toBe(true)
  })

  test('returns false for unrelated errors', () => {
    expect(isSnapshotSourceRunningError(new Error('permission denied'))).toBe(
      false,
    )
    expect(isSnapshotSourceRunningError(new Error('disk full'))).toBe(false)
  })

  test('returns false for non-error inputs', () => {
    expect(isSnapshotSourceRunningError(null)).toBe(false)
    expect(isSnapshotSourceRunningError(undefined)).toBe(false)
    expect(isSnapshotSourceRunningError('source running')).toBe(false)
    expect(isSnapshotSourceRunningError(42)).toBe(false)
  })
})

describe('snapshot-orchestration constants', () => {
  test('retry budget is 3 attempts', () => {
    expect(_internal.SNAPSHOT_MAX_ATTEMPTS).toBe(3)
  })

  test('first-attempt stop timeout is positive', () => {
    expect(_internal.STOP_TIMEOUT_MS).toBeGreaterThan(0)
  })
})
