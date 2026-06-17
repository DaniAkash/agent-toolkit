/**
 * Bypass-the-framework probe: talk to the bridge directly via our own
 * SandboxChannel + send a `start` frame with debug enabled. This gives
 * full visibility into what the bridge is doing while we wait.
 *
 * Run via:
 *   bun run build
 *   bun test/e2e/_probe.ts
 */

import { randomBytes } from 'node:crypto'
import { markBridgeStarting, waitForBridgeReady } from '@ai-sdk/harness/utils'
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel'
import { createAcpxHarness } from '../../src/acpx-harness.ts'
import { createAcpxChannel } from '../../src/sandbox-channel.ts'
import { readBridgeAssetFromDist } from './helpers.ts'

const TOKEN = process.env.VERCEL_TOKEN
const TEAM = process.env.VERCEL_TEAM_ID
const PROJECT = process.env.VERCEL_PROJECT_ID
const OPENAI_KEY = process.env.OPENAI_API_KEY

if (!TOKEN || !TEAM || !PROJECT || !OPENAI_KEY) {
  console.error('Missing required env vars')
  process.exit(1)
}

const t0 = Date.now()
const step = (label: string) => {
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2)
  console.log(`[probe ${elapsed}s] ${label}`)
}

const harness = createAcpxHarness({
  agent: 'codex',
  readBridgeAsset: readBridgeAssetFromDist,
})
const recipe = await harness.getBootstrap!()

step('creating sandbox...')
const provider = createVercelSandbox({
  token: TOKEN,
  teamId: TEAM,
  projectId: PROJECT,
  runtime: 'node22',
  ports: [4001],
  env: { OPENAI_API_KEY: OPENAI_KEY },
})
const session = await provider.createSession({})
step(`sandbox id=${session.id}, ports=${JSON.stringify(session.ports)}`)

try {
  const restricted = session.restricted()
  const port = session.ports[0]!
  const bridgeStateDir = `/tmp/bridge-state`
  const workdir = `/tmp/work`

  // Apply bootstrap manually.
  step('writing bootstrap files...')
  for (const file of recipe.files) {
    await restricted.writeTextFile({ path: file.path, content: file.content })
  }
  step('running bootstrap commands...')
  for (const cmd of recipe.commands) {
    const r = await restricted.run({ command: cmd.command })
    step(`  $ ${cmd.command} (exit=${r.exitCode})`)
    if (r.exitCode !== 0) {
      console.log(`  stderr: ${r.stderr.trim().slice(-1000)}`)
    }
  }
  await restricted.run({ command: `mkdir -p ${workdir} ${bridgeStateDir}` })

  // Mark bridge starting + spawn it.
  step('markBridgeStarting...')
  await markBridgeStarting({
    sandbox: restricted,
    bridgeStateDir,
    bridgeType: 'acpx',
  })

  step('spawning bridge...')
  const token = randomBytes(32).toString('hex')
  const proc = await restricted.spawn({
    command: `node /tmp/harness/acpx/bridge.mjs --workdir ${workdir} --bridge-state-dir ${bridgeStateDir}`,
    env: { BRIDGE_CHANNEL_TOKEN: token, BRIDGE_WS_PORT: String(port) },
  })

  step('waiting for bridge ready...')
  await waitForBridgeReady({
    proc,
    sandbox: restricted,
    bridgeStateDir,
    bridgeType: 'acpx',
    timeoutMs: 60_000,
  })
  step('bridge ready')

  step('opening channel...')
  const channel = createAcpxChannel({ sandboxSession: session, port, token })
  // Subscribe to every event type the bridge can send.
  const TYPES = [
    'stream-start',
    'text-start',
    'text-delta',
    'text-end',
    'reasoning-start',
    'reasoning-delta',
    'reasoning-end',
    'tool-call',
    'tool-approval-request',
    'tool-result',
    'finish-step',
    'finish',
    'file-change',
    'compaction',
    'error',
    'raw',
    'bridge-hello',
    'bridge-detach',
    'bridge-thread',
    'sandbox-log',
    'debug-event',
  ] as const
  for (const type of TYPES) {
    channel.on(type as never, (event: unknown) => {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2)
      console.log(
        `[probe ${elapsed}s] CHAN.${type}: ${JSON.stringify(event).slice(0, 800)}`,
      )
    })
  }
  // Wait for bridge-hello before sending start. The bridge emits it on
  // WS-connect to indicate it's ready to accept commands.
  const helloP = new Promise<void>((resolve) => {
    const unsub = channel.on('bridge-hello' as never, () => {
      unsub()
      resolve()
    })
  })

  await channel.open()
  step('channel open')

  step('waiting for bridge-hello...')
  await helloP
  step('bridge-hello received, sending start frame...')
  channel.send({
    type: 'start',
    prompt: 'Reply with exactly the word "ok" and nothing else.',
    agent: 'codex',
    sessionKey: 'probe-session',
    cwd: workdir,
    debug: { enabled: true, level: 'debug' },
  })
  step('waiting up to 90s for bridge to respond...')

  const start = Date.now()
  while (Date.now() - start < 90_000) {
    await new Promise((r) => setTimeout(r, 1000))
  }
  step('90s elapsed; stopping probe')

  step('snapshotting sandbox processes...')
  const ps = await restricted.run({
    command: 'ps -ef | grep -E "node|acpx|codex" | grep -v grep',
  })
  console.log(`  ps stdout:\n${ps.stdout}`)

  step('codex auth diagnostics...')
  const diags = [
    'echo "OPENAI_API_KEY length: ${#OPENAI_API_KEY}"',
    'codex --version 2>&1',
    'codex --help 2>&1 | head -50',
    'ls -la ~/.codex 2>&1',
    'cat ~/.codex/config.toml 2>&1 || echo "no config.toml"',
    'cat ~/.codex/auth.json 2>&1 || echo "no auth.json"',
    'npx --yes @zed-industries/codex-acp --help 2>&1 | head -30',
  ]
  for (const cmd of diags) {
    const r = await restricted.run({ command: cmd })
    console.log(`  $ ${cmd}`)
    console.log(`    exit=${r.exitCode}`)
    if (r.stdout) console.log(`    stdout: ${r.stdout.slice(0, 1500)}`)
    if (r.stderr) console.log(`    stderr: ${r.stderr.slice(0, 1500)}`)
  }
} finally {
  step('stopping sandbox...')
  await session.stop()
  step('done')
}
