# `acp-probe` end-to-end probes

These tests spawn **real** ACP adapter processes (claude, codex,
gemini) and run a real `initialize` + `session/new` handshake against
each. They live outside the default `bun test` run because:

- They require the corresponding CLIs to be installed locally
  (`claude`, `codex`, `gemini`).
- First-run `npx`-bootstrapped adapters take 30–60 s.
- They've not deterministic without a captive network.

**They consume zero LLM tokens** — the probe never sends a real
`session/prompt`. Auth tokens aren't required either: `session/new` is
free, and the probe defaults to `authPolicy: 'skip'`.

## Run

Gate with the `PROBE_E2E` environment variable:

```bash
# All three agents
PROBE_E2E=all bun test test/e2e

# One agent
PROBE_E2E=claude bun test test/e2e

# Multiple
PROBE_E2E=claude,codex bun test test/e2e
```

Or use the npm script:

```bash
bun run test:e2e
```

Unset (or value doesn't list a given agent) → all tests for that
agent skip silently.

## What each agent test covers

Two probe paths per agent:

1. **`probeAgent({ agent: 'claude' })`** — exercises the
   acpx-resolution path. `acpx` is a devDep here, so we have a
   working registry.
2. **`probeAgent({ command: 'npx -y @agentclientprotocol/claude-agent-acp@^0.31.0' })`**
   — exercises the no-acpx path. Spawn command is hardcoded; matches
   what a consumer who skipped the acpx peer-dep would write.

A third assertion runs both probes and confirms the resulting
`capabilities`, `models`, `modes`, `configOptions`, `reasoning`, and
`supportsConfigOption` are structurally identical — any drift here
means either the acpx registry has shifted away from the hardcoded
spawn command OR the probe behaves differently across the two paths.
Both are regressions.

## Per-agent setup

| Agent | Required | Notes |
|---|---|---|
| `claude` | `claude` CLI on `$PATH` + an authenticated login | First run npx-downloads the ACP adapter (~30 s). |
| `codex` | `codex` CLI on `$PATH` | npx-downloads the ACP adapter on first run. |
| `gemini` | `gemini` CLI on `$PATH` + `gemini auth login` once | Loads the adapter from the local install. |

If a CLI isn't installed, the spawn fails and the test reports
`error: { code: 'spawn_failed' }` — the test then fails its
`expect(r.error).toBeUndefined()` assertion, which is the right
signal to install the missing CLI.

## When to run

- Before cutting a release.
- After bumping the adapter version ranges in acpx's
  `AGENT_REGISTRY`.
- When changing anything in `probe.ts`, `resolve-command.ts`, or
  `_internal/normalize.ts`.
- Whenever you suspect upstream adapter drift (claude/codex/gemini
  ship adapter updates without bumping their CLIs).

## Why not CI

- The agent CLIs aren't installed on GitHub Actions runners.
- `npx` first-run downloads are slow and network-fragile.
- This isn't catching anything the fixture-based unit tests don't
  catch *until* an adapter actually drifts — at which point we'd be
  watching the npm version anyway.

If/when we want CI coverage, the right approach is recording fresh
fixtures from each agent (the same JSON our unit tests already use)
and snapshot-asserting them — same shape, no spawn cost. Out of scope
for v0.0.1.
