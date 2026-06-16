import type {
  HarnessV1NetworkSandboxSession,
  HarnessV1Prompt,
} from '@ai-sdk/harness'
import type { Experimental_SandboxProcess } from '@ai-sdk/provider-utils'

const PROC_EXIT_TIMEOUT_MS = 5_000

/**
 * Best-effort wait for the bridge process to exit, falling back to a kill
 * after a short timeout. Idempotent and tolerant of `undefined` so the
 * ATTACH path (where we don't own the proc handle) can call into it.
 */
export async function awaitProcExit(
  proc: Experimental_SandboxProcess | undefined,
): Promise<void> {
  if (!proc) return
  try {
    await Promise.race([
      proc.wait(),
      new Promise<void>((resolve) => setTimeout(resolve, PROC_EXIT_TIMEOUT_MS)),
    ])
  } finally {
    try {
      await proc.kill()
    } catch {
      /* idempotent */
    }
  }
}

export function pickPort(
  sandboxSession: HarnessV1NetworkSandboxSession,
  override: number | undefined,
): number {
  if (override !== undefined) return override
  const first = sandboxSession.ports[0]
  if (first === undefined) {
    throw new Error(
      'acpx-ai-harness: the sandbox session exposes no ports; cannot launch the bridge.',
    )
  }
  return first
}

/** Single-argument POSIX-style shell quoting for paths passed as CLI args. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/**
 * Flatten the harness prompt (string or UserModelMessage) into the plain
 * string the ACP runtime accepts. Non-text message parts are dropped because
 * acpx's transport only carries text + base64 attachments, and attachments
 * aren't wired through the harness contract yet.
 */
export function extractPromptText(prompt: HarnessV1Prompt): string {
  if (typeof prompt === 'string') return prompt
  const content = prompt.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text: string }).text)
      .join('')
  }
  return ''
}
