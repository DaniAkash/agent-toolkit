import type { SnapshotApi } from '../../src/template-cache.ts'

export interface MockSnapshotApiOptions {
  /** Snapshot names that already exist when the test starts. */
  readonly existing?: ReadonlyArray<string>
  /** Error thrown from stopAndSnapshot on the next call. */
  readonly stopAndSnapshotError?: Error
  /**
   * Throw on the first N stopAndSnapshot attempts before succeeding —
   * exercises the retry path of the orchestration without touching a real
   * microsandbox.
   */
  readonly stopAndSnapshotTransientFailures?: number
}

/**
 * In-memory `SnapshotApi` stub. Records every call and tracks an internal
 * set of "existing" snapshot names so callers can simulate
 * `snapshotExists()` answers across the lifetime of one cache.
 */
export class MockSnapshotApi implements SnapshotApi {
  readonly calls: Array<
    | { method: 'stopAndSnapshot'; sandboxName: string; snapshotName: string }
    | { method: 'snapshotExists'; snapshotName: string }
    | { method: 'removeSnapshotIfExists'; snapshotName: string }
  > = []

  private existing: Set<string>
  private stopAndSnapshotAttempts = 0

  constructor(private readonly opts: MockSnapshotApiOptions = {}) {
    this.existing = new Set(opts.existing ?? [])
  }

  async stopAndSnapshot(
    sandboxName: string,
    snapshotName: string,
  ): Promise<void> {
    this.calls.push({ method: 'stopAndSnapshot', sandboxName, snapshotName })
    this.stopAndSnapshotAttempts += 1
    if (
      this.opts.stopAndSnapshotTransientFailures &&
      this.stopAndSnapshotAttempts <=
        this.opts.stopAndSnapshotTransientFailures
    ) {
      throw Object.assign(new Error('snapshot source running'), {
        code: 'SnapshotSourceRunning',
      })
    }
    if (this.opts.stopAndSnapshotError) throw this.opts.stopAndSnapshotError
    this.existing.add(snapshotName)
  }

  async snapshotExists(snapshotName: string): Promise<boolean> {
    this.calls.push({ method: 'snapshotExists', snapshotName })
    return this.existing.has(snapshotName)
  }

  async removeSnapshotIfExists(snapshotName: string): Promise<void> {
    this.calls.push({ method: 'removeSnapshotIfExists', snapshotName })
    this.existing.delete(snapshotName)
  }

  /** Test-only: drop a snapshot out-of-band to simulate external deletion. */
  forgetSnapshot(snapshotName: string): void {
    this.existing.delete(snapshotName)
  }
}
