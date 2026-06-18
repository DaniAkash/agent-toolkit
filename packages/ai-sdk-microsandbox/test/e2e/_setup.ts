import { describe } from 'bun:test'

/**
 * Gates a describe-block on the real-Codex-e2e env. Requires both:
 *   - MICROSANDBOX_INTEGRATION=1 (real microVM platform available)
 *   - OPENAI_API_KEY set to a non-empty value
 *
 * The whole describe block is registered as `describe.skip` when either
 * is missing, so the file's beforeAll/afterAll hooks never run.
 */
export function requireE2eEnv(): typeof describe | typeof describe.skip {
  if (process.env.MICROSANDBOX_INTEGRATION !== '1') return describe.skip
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.length < 20) {
    return describe.skip
  }
  return describe
}

/**
 * Silence the unhandled WebSocket `ErrorEvent`s that bun emits when a
 * codex bridge dies during sandbox teardown. The harness adapter's
 * WebSocket client doesn't attach an `onerror` handler, so bun catches
 * the post-close error event globally and (in test mode) attributes
 * it to whatever test happens to be running. The events are benign
 * post-mortem signals; we suppress them so they don't flake unrelated
 * tests. Reachable error paths still surface through the normal
 * `result.fullStream` and `error` parts and through rejected Promises.
 */
function installWsErrorSilencer(): void {
  const previous = process.listeners('uncaughtException').slice()
  const handler = (err: unknown): void => {
    const msg =
      err != null && typeof err === 'object' && 'message' in err
        ? String((err as { message?: unknown }).message ?? '')
        : ''
    if (
      msg.includes('WebSocket connection') ||
      msg.includes('Connection ended')
    ) {
      return
    }
    for (const fn of previous) {
      ;(fn as (e: unknown) => void)(err)
    }
  }
  process.removeAllListeners('uncaughtException')
  process.on('uncaughtException', handler)
}

installWsErrorSilencer()

/** Generous per-test budget. Codex turns can take 30s+ end to end. */
export const E2E_TEST_TIMEOUT_MS = 5 * 60 * 1000

/** Image used for every Codex e2e test. Needs Node 22 for `npx codex`. */
export const CODEX_E2E_IMAGE = 'node:22-bookworm-slim'

/** Port the bridge listens on inside the sandbox. */
export const CODEX_BRIDGE_PORT = 4000
