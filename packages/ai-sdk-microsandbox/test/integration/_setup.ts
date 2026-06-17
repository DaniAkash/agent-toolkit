import { describe } from 'bun:test'

/**
 * Gates a describe-block on `MICROSANDBOX_INTEGRATION=1`. Used by every
 * integration test file so the whole file is skipped cleanly when the
 * gate isn't met (no Bun NAPI calls, no microVM boot).
 *
 * Integration tests require a working microsandbox install: KVM on Linux
 * or Apple Silicon on macOS. The microsandbox CLI must already have run
 * `microsandbox setup` once on the host so /var/lib/microsandbox exists.
 */
export function requireIntegrationEnv():
  | typeof describe
  | typeof describe.skip {
  return process.env.MICROSANDBOX_INTEGRATION === '1' ? describe : describe.skip
}

/** Per-test budget for sandbox boot + work. Tuned to be generous on first run. */
export const INTEGRATION_TEST_TIMEOUT_MS = 120_000

/** Minimal Linux image used for plain integration tests (no agent involved). */
export const DEFAULT_INTEGRATION_IMAGE = 'debian:bookworm-slim'
