# Smoke tests

End-to-end tests against **real ACP agents**. Not run in CI — they
spawn agent processes, make real API calls, and need authenticated
credentials. Run them locally before tagging a release, or whenever
you're touching `language-model.ts` / `provider.ts` and want to make
sure nothing drifted against the live runtime.

## Run

```bash
# All three agents (Claude + Codex + Gemini)
SMOKE_AGENTS=all bun test test/e2e

# Or via the shorthand script
bun run test:smoke

# Just one
SMOKE_AGENTS=claude bun test test/e2e

# Two of them
SMOKE_AGENTS=claude,codex bun test test/e2e
```

When `SMOKE_AGENTS` is unset (or doesn't list an agent), all five
tests for that agent are skipped. The regular unit / integration
suite is unaffected — it always runs.

## Per-agent setup

| Agent | Auth | First-run cost |
|---|---|---|
| `claude` | `ACPX_AUTH_ANTHROPIC_API_KEY` (or `ANTHROPIC_API_KEY`) | `npx`-downloads `@agentclientprotocol/claude-agent-acp` (~30s) |
| `codex` | `ACPX_AUTH_OPENAI_API_KEY` (or `OPENAI_API_KEY`) | `npx`-downloads `@zed-industries/codex-acp` |
| `gemini` | local `gemini` CLI installed and authenticated (`gemini auth login`) | none (uses local CLI) |

## What each test catches

For every enabled agent we run five tests, each targeted at a
distinct breakage class the mock harness can't see:

1. **`doctor()`** — agent registry resolution. If `acpx` can't find
   the adapter, this is the first thing that breaks.
2. **`generateText`** — agent process spawn, ACP handshake, basic
   text-delta flow, finish part fires.
3. **`streamText`** — incremental stream forwarding (chunks arrive
   one at a time, not as a single blob), stream completion.
4. **Persistent multi-turn** — file-backed session store, our
   fresh-vs-continuation prompt-mode logic, the agent's own context
   retention across our session boundary.
5. **`generateObject`** — JSON cleanup transform against real agent
   output (Codex in particular tends to wrap in ` ```json ` fences),
   schema-instruction injection in the prompt.

## When a test flakes

Real agents flake. If a test fails once but passes on rerun:

- **Auth**: confirm the env var is set in your shell
  (`echo $ACPX_AUTH_ANTHROPIC_API_KEY | head -c 8`).
- **Rate limit**: wait a minute and retry.
- **Agent CLI version skew**: `npx clear-npx-cache` then rerun — the
  registry pins a range, but a recent npx pull may have grabbed a
  buggy patch.
- **Prompt-following drift**: the JSON test in particular relies on
  the agent following "return only JSON". If a model release is
  noisier, the expected schema match may fail. File an issue with the
  raw output.

When a test fails consistently, file an issue with: agent id, agent
adapter version (visible in the `npx`-resolved binary path),
authenticated provider (e.g. Anthropic vs Bedrock), and the failing
test name.
