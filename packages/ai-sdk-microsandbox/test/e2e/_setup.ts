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

/** Generous per-test budget. Codex turns can take 30s+ end to end. */
export const E2E_TEST_TIMEOUT_MS = 5 * 60 * 1000

/** Image used for every Codex e2e test. Needs Node 22 for `npx codex`. */
export const CODEX_E2E_IMAGE = 'node:22-bookworm-slim'

/** Port the bridge listens on inside the sandbox. */
export const CODEX_BRIDGE_PORT = 4000
