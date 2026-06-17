import type {
  HarnessV1NetworkSandboxSession,
  HarnessV1Prompt,
} from '@ai-sdk/harness'
import type { Experimental_SandboxProcess } from '@ai-sdk/provider-utils'

const PROC_EXIT_TIMEOUT_MS = 5_000
const STDERR_TAIL_LINES = 50

/**
 * Drain a sandbox process's stderr into a bounded ring buffer of the
 * last `STDERR_TAIL_LINES` lines. `waitForBridgeReady` only reads stdout;
 * when the bridge crashes the actual error usually lands on stderr, so
 * we capture it in parallel and surface it in the host's error message.
 *
 * Runs in the background; never throws. If the stream is unavailable or
 * the read loop fails, the tail just stays empty rather than tripping
 * the happy path.
 */
export function tailStderr(proc: Experimental_SandboxProcess): {
  read(): string[]
} {
  const tail: string[] = []
  // Cast through unknown: Node's `stream/web` ReadableStream and the lib.dom
  // global one have nominally distinct types in TS even though they're
  // structurally identical.
  const reader = (
    proc.stderr as unknown as ReadableStream<Uint8Array>
  ).getReader()
  void drainLines(reader, (line) => {
    tail.push(line)
    if (tail.length > STDERR_TAIL_LINES) tail.shift()
  })
  return { read: () => [...tail] }
}

async function drainLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  push: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder()
  let pending = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        if (pending.length > 0) push(pending)
        return
      }
      pending += decoder.decode(value, { stream: true })
      pending = flushCompleteLines(pending, push)
    }
  } catch {
    /* don't crash the happy path on a reader failure */
  }
}

function flushCompleteLines(
  buffer: string,
  push: (line: string) => void,
): string {
  let rest = buffer
  while (true) {
    const idx = rest.indexOf('\n')
    if (idx < 0) return rest
    push(rest.slice(0, idx))
    rest = rest.slice(idx + 1)
  }
}

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
