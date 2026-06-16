import type {
  HarnessV1NetworkSandboxSession,
  HarnessV1Prompt,
} from '@ai-sdk/harness'

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
