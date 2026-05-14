# acp-probe

> Probe any [Agent Client Protocol](https://agentclientprotocol.com)
> agent for its capabilities — models, modes, configOptions, prompt
> capabilities, auth methods, MCP transports — without sending a real
> prompt.

[![npm](https://img.shields.io/npm/v/acp-probe.svg)](https://www.npmjs.com/package/acp-probe)

> [!WARNING]
> **Alpha software.** This package is in active development. The public
> API may change between minor versions without notice until `1.0.0`.
> Pin exact versions; expect rough edges.

## What it does

Given an ACP-compatible agent (built-in like `claude` / `codex` /
`gemini` or any custom adapter you can spawn), `acp-probe` performs
the ACP `initialize` + `session/new` handshake, optionally pings
`session/set_config_option` to detect `-32601`, then tears the agent
down. The result is a typed, schema-stable `AgentProbeResult` you can
feed into a settings UI, picker, or downstream `AcpRuntimeOptions`
call.

**No LLM tokens are consumed.** `session/new` is free; we never call
`session/prompt`.

## Install

```bash
bun add acp-probe
# or
npm install acp-probe
```

The only hard dependency is
[`@agentclientprotocol/sdk`](https://www.npmjs.com/package/@agentclientprotocol/sdk).
[`acpx`](https://www.npmjs.com/package/acpx) is an **optional peer**
— installed, it lets you use the built-in `{ agent: 'claude' }`
shorthand; absent, you pass `{ command }` or `{ argv }` yourself.

## Quickstart

```ts
import { probeAgent } from 'acp-probe'

// Custom ACP command — the canonical entry point. Zero acpx
// involvement; works with any agent you can spawn.
const result = await probeAgent({
  command: 'my-acp-agent --stdio',
})

console.log(result.models)         // ProbedModel[]
console.log(result.modes)          // ProbedMode[]
console.log(result.configOptions)  // ProbedConfigOption[]
console.log(result.reasoning)      // { configId, values, defaultValue } | null
console.log(result.capabilities.promptCapabilities)
//        => { image: boolean, audio: boolean, embeddedContext: boolean }

// Built-in shorthand — requires acpx to be installed.
const claude = await probeAgent({ agent: 'claude' })
```

## Result shape

```ts
interface AgentProbeResult {
  agent: {
    id: string | null
    command: string
    argv: readonly string[]
    probedAt: string  // ISO timestamp
    durationMs: number
  }
  protocolVersion: number
  agentInfo: { name; title?; version? } | null
  capabilities: {
    loadSession: boolean
    promptCapabilities: { image; audio; embeddedContext }
    mcpCapabilities: { http; sse; meta? }
    sessionCapabilities: { close; list; resume; fork; additionalDirectories }
    experimental?: { auth; nes; providers; positionEncoding }
  }
  authMethods: AuthMethod[]
  models: Array<{ id; name?; description? }>
  modes: Array<{ id; name?; description? }>
  configOptions: ProbedConfigOption[]
  /** Derived pointer to the configOption with category='thought_level'. */
  reasoning: { configId; values; defaultValue? } | null
  /** False on agents that return ACP -32601 for session/set_config_option. */
  supportsConfigOption: boolean
  error?: ProbeError
  /** Verbatim init + session/new responses for callers that need _meta. */
  raw: { initialize; newSession }
}
```

## Errors

Two distinct error surfaces:

- **`AgentResolveError`** (thrown sync): caller passed `{ agent: <id> }`
  but acpx isn't installed / doesn't recognise the id. Includes
  `resolveCause: 'acpx_not_installed' | 'acpx_incompatible' | 'unknown_agent'`.
- **`AgentProbeResult.error`** (returned, not thrown): probe ran but
  couldn't complete cleanly. Includes `code: 'spawn_failed' |
  'initialize_timeout' | 'session_new_timeout' | 'auth_required' |
  'protocol_mismatch' | 'agent_crashed' | 'unknown'` plus `stderr` for
  debugging.

## Options

| option | type | default | notes |
|---|---|---|---|
| `agent` | `string` | — | Built-in agent id (requires acpx). |
| `command` | `string` | — | Raw command, shell-split. |
| `argv` | `readonly string[]` | — | Pre-split argv (takes precedence over `command`). |
| `cwd` | `string` | `process.cwd()` | Working dir for the spawned agent. |
| `env` | `Record<string, string>` | `{}` | Merged into the spawned process's env. |
| `authPolicy` | `'skip' \| 'fail'` | `'skip'` | `'skip'`: record `authMethods` and continue. `'fail'`: don't call `session/new`. |
| `timeoutMs` | `number` | `30_000` | Hard cap on the full probe lifecycle. |

Exactly one of `agent`, `command`, or `argv` is required.

## Captured fixtures (2026-05-14)

The repo ships recorded `initialize` + `session/new` responses for
claude / codex / gemini under `test/fixtures/`. They power the unit
test suite and document the per-agent capability matrix at the time
of capture.

## Relationship to acpx

`acp-probe` is upstream of `acpx` in the data flow: probe → capabilities
→ feed `AcpRuntimeOptions`. The probe doesn't depend on acpx at
runtime unless you use the `{ agent: <id> }` shorthand, in which case
it lazy-imports `acpx/runtime` to resolve via acpx's built-in agent
registry. Custom-agent users never touch acpx.

## License

MIT — see [LICENSE](./LICENSE).
