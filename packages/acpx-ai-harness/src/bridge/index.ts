import { runBridge } from '@ai-sdk/harness/bridge'
import { acpxBridgeStartMessageSchema } from '../acpx-bridge-protocol.ts'

/**
 * Entry point for the in-sandbox bridge process.
 *
 * Spawned by the host with `--workdir <path> --bridge-state-dir <path>` and
 * environment variables `BRIDGE_CHANNEL_TOKEN` / `BRIDGE_WS_PORT`. Boots a
 * WebSocket server (via @ai-sdk/harness/bridge) and services one prompt
 * turn per `start` frame from the host.
 *
 * The real turn driver lands on the next commit. For now `onStart` validates
 * the start frame and exits via the harness error path, so the build pipeline
 * is exercisable end-to-end without committing to acpx wiring yet.
 */

function parseArgs(argv: ReadonlyArray<string>): {
  workdir?: string
  bridgeStateDir?: string
} {
  const out: { workdir?: string; bridgeStateDir?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (!value) continue
    if (flag === '--workdir') {
      out.workdir = value
      i++
    } else if (flag === '--bridge-state-dir') {
      out.bridgeStateDir = value
      i++
    }
  }
  return out
}

function emitFatal(message: string): never {
  process.stderr.write(`acpx-ai-harness bridge: ${message}\n`)
  process.exit(1)
}

const args = parseArgs(process.argv.slice(2))
if (!args.workdir) emitFatal('Missing --workdir argument.')
if (!args.bridgeStateDir) emitFatal('Missing --bridge-state-dir argument.')

await runBridge({
  bridgeType: 'acpx',
  bridgeStateDir: args.bridgeStateDir!,
  onStart: async (start, turn) => {
    const parsed = acpxBridgeStartMessageSchema.parse(start)
    turn.emit({ type: 'stream-start' })
    turn.emit({
      type: 'error',
      error: {
        message:
          'acpx-ai-harness: bridge turn driver not implemented yet. ' +
          `Received start for agent=${parsed.agent}, sessionKey=${parsed.sessionKey}.`,
        code: 'not-implemented',
      },
    })
    turn.emit({
      type: 'finish',
      finishReason: { unified: 'error', raw: 'not-implemented' },
      totalUsage: {
        inputTokens: {
          total: undefined,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: undefined,
          text: undefined,
          reasoning: undefined,
        },
      },
    })
  },
  onDetach: () => ({}),
})
