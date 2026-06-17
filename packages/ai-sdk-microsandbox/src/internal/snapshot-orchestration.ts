import { Sandbox, Snapshot } from 'microsandbox'

/**
 * Grace period given to `stopWithTimeout` on the first attempt to stop a
 * sandbox before snapshotting. Subsequent retries skip the grace period and
 * SIGKILL immediately.
 */
const STOP_TIMEOUT_MS = 10_000

/**
 * Maximum number of times {@link stopAndSnapshot} will retry the
 * stop-then-snapshot sequence when the source sandbox is still alive.
 * Patterned after `vercel/eve`'s `microsandbox-runtime.ts:512` retry loop.
 */
const SNAPSHOT_MAX_ATTEMPTS = 3

/**
 * Detect microsandbox's "snapshot source still running" error. The exact
 * code is not yet stable in the published TS SDK; match defensively on the
 * message until we can pin a typed error.
 */
function isSnapshotSourceRunningError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (code === 'SnapshotSourceRunning' || code === 'SOURCE_RUNNING') return true
  const message = (error as { message?: unknown }).message
  if (typeof message !== 'string') return false
  return /source.*running|sandbox.*alive|running.*snapshot/i.test(message)
}

/**
 * Stop the named sandbox and capture a snapshot. Retries up to three times
 * if microsandbox reports the source as still running — on retry we drop
 * the grace period and SIGKILL before attempting the snapshot again.
 *
 * Adapted from `vercel/eve`'s `stopAndSnapshotMicrosandboxSandbox` in
 * `microsandbox-runtime.ts:512-530`. Behaviour is the same; we omit Eve's
 * logger plumbing and use our own error-detection heuristic.
 */
export async function stopAndSnapshot(
  sandboxName: string,
  snapshotName: string,
): Promise<void> {
  for (let attempt = 0; attempt < SNAPSHOT_MAX_ATTEMPTS; attempt += 1) {
    const handle = await Sandbox.get(sandboxName)
    await handle
      .stopWithTimeout(attempt === 0 ? STOP_TIMEOUT_MS : 0)
      .catch(() => {
        // Stop failures are tolerated here; if the sandbox truly can't be
        // stopped the snapshot below will surface a real error.
      })
    try {
      await handle.snapshot(snapshotName)
      return
    } catch (error) {
      const lastAttempt = attempt === SNAPSHOT_MAX_ATTEMPTS - 1
      if (!isSnapshotSourceRunningError(error) || lastAttempt) {
        throw error
      }
      await handle.kill().catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

/**
 * Check whether a named snapshot exists. Wraps `Snapshot.get` because the
 * SDK throws on missing snapshots and we want a boolean return.
 */
export async function snapshotExists(snapshotName: string): Promise<boolean> {
  try {
    await Snapshot.get(snapshotName)
    return true
  } catch {
    return false
  }
}

/**
 * Remove a snapshot if it exists; silently succeed if it doesn't. Mirrors
 * Eve's `removeSnapshotIfExists`. Useful for cleaning up after a failed
 * rebuild or when invalidating a stale template.
 */
export async function removeSnapshotIfExists(
  snapshotName: string,
): Promise<void> {
  try {
    await Snapshot.remove(snapshotName, { force: true })
  } catch {
    // Treat any "not found" / "missing" error as success.
  }
}

/** Exported for unit-test access. Not part of the public package surface. */
export const _internal = {
  isSnapshotSourceRunningError,
  STOP_TIMEOUT_MS,
  SNAPSHOT_MAX_ATTEMPTS,
}
