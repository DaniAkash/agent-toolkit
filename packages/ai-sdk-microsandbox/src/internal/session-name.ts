/** Prefix applied to every provider-minted sandbox name. */
export const SESSION_NAME_PREFIX = 'ai-sdk-harness'

/** Microsandbox names are limited to 128 UTF-8 bytes (per the SDK JSDoc). */
const MAX_NAME_BYTES = 128

/**
 * Derive a deterministic sandbox name from a harness session id. Disallowed
 * characters are slugified; the result is truncated defensively so the
 * underlying `Sandbox.builder(name)` call doesn't reject.
 */
export function sessionSandboxName(sessionId: string): string {
  const slug = sessionId.replace(/[^a-zA-Z0-9-]/g, '-')
  const full = `${SESSION_NAME_PREFIX}-${slug}`
  return clampName(full)
}

/**
 * Generate a random sandbox name for sessions without a stable id. Format:
 * `ai-sdk-harness-auto-<8-char-random>`.
 */
export function autoSessionName(): string {
  return `${SESSION_NAME_PREFIX}-auto-${randomSuffix()}`
}

function randomSuffix(): string {
  // 8 chars of base36 = ~2.8 trillion possibilities; collision risk is
  // negligible for the realistic concurrent-session counts microsandbox can
  // host on one machine.
  return Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 36).toString(36),
  ).join('')
}

function clampName(name: string): string {
  if (Buffer.byteLength(name, 'utf8') <= MAX_NAME_BYTES) return name
  // Truncate by characters then re-check bytes — handles non-ASCII safely.
  let truncated = name
  while (Buffer.byteLength(truncated, 'utf8') > MAX_NAME_BYTES) {
    truncated = truncated.slice(0, -1)
  }
  return truncated
}
