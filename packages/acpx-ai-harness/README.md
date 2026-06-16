# acpx-ai-harness

A Vercel AI SDK v7 `HarnessV1` adapter built on the [acpx](https://www.npmjs.com/package/acpx) runtime. Brings any ACP-protocol agent (Claude Code, Codex, Gemini, Copilot, Cursor) into the [AI SDK Harnesses](https://ai-sdk.dev/v7/docs/ai-sdk-harnesses/overview) ecosystem alongside `@ai-sdk/harness-claude-code`, `@ai-sdk/harness-codex`, and `@ai-sdk/harness-pi`.

> **Experimental.** Both this package and the upstream `@ai-sdk/harness` API are pre-1.0 and subject to breaking changes.

## Install

```bash
npm install acpx-ai-harness @ai-sdk/harness ai acpx
```

`acpx-ai-harness` declares `@ai-sdk/harness`, `ai`, and `acpx` as peer dependencies, so the consumer pins them. A sandbox provider with port exposure is also required, see [Sandbox setup](#sandbox-setup) below.

## Quick start

```ts
import { HarnessAgent } from '@ai-sdk/harness/agent'
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel'
import { acpxHarness } from 'acpx-ai-harness'

const agent = new HarnessAgent({
  harness: acpxHarness, // defaults to agent='codex'
  sandbox: createVercelSandbox({ runtime: 'node22' }),
  instructions: 'You are a careful refactoring assistant.',
})

const session = await agent.createSession()
try {
  const result = await agent.stream({
    session,
    prompt: 'Refactor user.ts to use Result<T, E>',
  })
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') process.stdout.write(part.delta)
  }
} finally {
  await session.destroy()
}
```

`acpxHarness` is the default instance for the codex agent. Use `createAcpxHarness({ agent, model, ... })` to switch agents or pin a specific model:

```ts
import { createAcpxHarness } from 'acpx-ai-harness'

const harness = createAcpxHarness({
  agent: 'claude',
  model: 'claude-opus-4-7',
  permissionMode: 'allow-reads',
})
```

| Setting | Type | Notes |
|---|---|---|
| `agent` | `string` | ACP agent id: `'codex'`, `'claude'`, `'gemini'`, or any custom acpx-registered agent. Default `'codex'`. |
| `model` | `string` | Overrides the agent's default model. Passed through to acpx as `sessionOptions.model`. |
| `stateDir` | `string` | acpx state directory inside the sandbox. Defaults to acpx's own default. |
| `startupTimeoutMs` | `number` | Bridge startup timeout. Default `120_000`. |
| `port` | `number` | Sandbox port for the bridge WebSocket. Defaults to the first port the sandbox exposes. |

## Sandbox setup

`acpx-ai-harness` is a bridge-backed adapter: it spawns a Node.js process inside the sandbox that drives the ACP agent and serves a WebSocket to the host. The sandbox provider must support **port exposure** for the host to reach that WebSocket.

| Provider | Works? | Notes |
|---|---|---|
| [`@ai-sdk/sandbox-vercel`](https://www.npmjs.com/package/@ai-sdk/sandbox-vercel) | Yes | Cloud sandbox, supports port exposure + snapshots. Requires `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`. |
| [`@ai-sdk/sandbox-just-bash`](https://www.npmjs.com/package/@ai-sdk/sandbox-just-bash) | No | Local sandbox, doesn't expose ports. Bridge-backed adapters reject it at start. Useful for non-bridge harnesses. |

Other sandbox providers conforming to `HarnessV1SandboxProvider` work as long as their network sandbox session implements `getPortUrl({ port, protocol: 'ws' })`.

### Agents

The ACP agent binary (e.g. `codex`, `claude`, `gemini`) must be available on the sandbox image at `acpx`'s startup. For Vercel sandbox you can bake the install into the runtime image, install at session start via an `onSandboxSession` hook on `HarnessAgent`, or pre-fork a snapshot.

## Lifecycle

`acpxHarness` implements the full `HarnessV1Session` surface except `doCompact` (acpx auto-compacts internally; manual compaction has no API and the method throws `HarnessCapabilityUnsupportedError`).

```ts
const session = await agent.createSession()

// Run a turn
await agent.stream({ session, prompt: '...' })

// Park the session for later (bridge stays alive, runtime stays alive)
const state = await session.detach()

// In a later process, resume:
const resumed = await agent.createSession({ sessionId: session.sessionId, resumeFrom: state })

// Or stop entirely (bridge exits, state captured for resume)
const stopState = await session.stop()
```

The harness chooses between two recovery rungs when `createSession({ resumeFrom })` or `createSession({ continueFrom })` is called:

1. **ATTACH.** When the saved bridge coords are still live (same sandbox id, reachable WebSocket), the host reconnects to the running bridge and replays buffered events past the saved cursor.
2. **RERUN.** If the bridge is gone (sandbox cycled, port lost), a fresh bridge spawns and the acpx session is reloaded from disk via `sessionKey`. For `continueFrom`, a `Continue.` nudge is sent so the agent picks up where it left off. The tail of the prior turn isn't replayed; the agent continues from its persisted state.

## Permission modes

Built-in tool approvals from the underlying ACP agent are gated by the harness `permissionMode`:

| Harness mode | acpx mode | Behaviour |
|---|---|---|
| `allow-all` (default) | `approve-all` | Every tool call auto-approved. |
| `allow-edits` | `approve-all` | acpx's `approve-all` already covers the edits bucket. |
| `allow-reads` | `approve-reads` | Reads/searches auto-approved; edits and shell raise an approval request via `tool-approval-request`. |

The host receives `tool-approval-request` stream parts for any tool the agent wants to call, and responds via the `HarnessV1PromptControl.submitToolApproval({ approvalId, approved, reason? })` method.

## Current limitations

- **Host AI SDK tools are not yet forwarded to the agent.** Tools passed via `HarnessAgent({ tools })` emit an `unsupported-tool` `CallWarning` on `stream-start` and are otherwise ignored. acpx's runtime only accepts wire-protocol MCP servers (stdio / http / sse), so a host-side MCP server inside the bridge needs to land before this works end-to-end. Stdio / http / sse MCP servers passed via the start frame's `mcpServers` field flow through verbatim today.
- **No manual compaction.** `doCompact()` throws `HarnessCapabilityUnsupportedError`. acpx delegates compaction to the underlying agent.
- **`@ai-sdk/sandbox-just-bash` is rejected** because just-bash can't expose ports. Use a sandbox provider that does.

## Built-in tools

The harness advertises the seven harness common-tool entries (`read`, `write`, `edit`, `bash`, `grep`, `glob`, `webSearch`) so cross-harness consumers can identify them. Per-agent native tool names (Claude's `Bash`, Codex's `shell`, Gemini's `run_shell_command`) are normalised to the common names on the wire; the original native name flows along on `tool-call.nativeName`.

## Development

```bash
bun install
bun run build           # emits dist/index.js + dist/bridge/index.js
bun run test            # unit + integration tests (no sandbox needed)
SMOKE_AGENTS=codex \
  VERCEL_TOKEN=... \
  VERCEL_TEAM_ID=... \
  VERCEL_PROJECT_ID=... \
  bun run test:e2e      # spawn real codex on Vercel sandbox
```

## License

MIT
