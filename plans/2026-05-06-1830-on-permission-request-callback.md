# `acpx-ai-provider` — `onPermissionRequest` callback option

## Goal

Add a programmatic permission callback to `acpx-ai-provider` so host applications can intercept the agent's per-call permission requests (e.g. codex's `apply_patch`, claude's `Edit`, shell commands) and resolve them with their own UI — instead of being limited to the current up-front mode-based gate (`approve-all` / `approve-reads` / `deny-all`).

After this change, host apps will be able to:

```ts
const provider = createAcpxProvider({
  agent: 'codex',
  cwd: '/Users/me/code',
  permissionMode: 'approve-reads', // still the up-front fallback
  onPermissionRequest: async (req, { signal }) => {
    // Show a UI, await user click. Return the decision, or `undefined`
    // to fall through to the existing mode-based logic.
    const decision = await myUi.prompt({
      title: req.raw.toolCall.title,
      kind: req.inferredKind,
    })
    return decision // 'approve_once' | 'approve_always' | 'deny' | undefined
  },
})
```

The downstream consumer driving this work is BrowserOS (a browser extension that bridges ACP coding agents into a chat UI). They want approve/deny CTA cards inline in chat, similar to how they already render OAuth-connect prompts for MCP servers. The mode-based gate was too coarse — `approve-reads` silently denies writes (codex's `apply_patch` aborts with no signal), `approve-all` skips approval entirely. A per-call callback is the right primitive.

## Prerequisite

**The underlying `acpx` package MUST expose `onPermissionRequest` in its `AcpRuntimeOptions` first.** This is a separate change in the upstream `acpx` repo (the ACP runtime, not this AI-SDK bridge). That work is tracked separately; this plan picks up once the new `acpx` is published.

Verification before starting:

```bash
# In ~/workbench/DaniAkash/acpx
bun install
node -e "console.log(require('acpx/package.json').version)"  # confirm new minor

# Inspect the runtime types — `onPermissionRequest` must be listed:
grep -A3 "AcpRuntimeOptions" node_modules/acpx/dist/runtime.d.ts | head -50
```

If `onPermissionRequest` is **not** present in `AcpRuntimeOptions` after the bump, stop — the upstream change hasn't shipped yet. Comment on this plan file with the blocker.

The expected upstream shape (from the BrowserOS plan that drove this work):

```ts
// In acpx/runtime
export interface AcpPermissionRequest {
  sessionId: string
  /** Full original ACP RequestPermissionRequest. */
  raw: RequestPermissionRequest
  /** Inferred from title/kind so hosts can branch without re-parsing. */
  inferredKind: ToolKind
}

export type AcpPermissionDecision =
  | { outcome: 'approve_once' }
  | { outcome: 'approve_always' }
  | { outcome: 'deny' }
  | { outcome: 'cancel' }

export interface AcpRuntimeOptions {
  // …existing fields…
  onPermissionRequest?: (
    req: AcpPermissionRequest,
    ctx: { signal: AbortSignal },
  ) => Promise<AcpPermissionDecision | undefined>
}
```

If the upstream lands with slightly different naming (e.g. `outcome` shape differs, or `inferredKind` is named differently), align this plan's types to match before writing code — the runtime is the source of truth.

## Source / Context

### What this package does today

`acpx-ai-provider` is a thin Vercel AI SDK adapter on top of `acpx/runtime`. It turns an ACP-spawned coding agent (Claude Code, Codex, Gemini, Cursor, …) into a `LanguageModelV2` that the AI SDK can drive via `generateText`/`streamText`.

Today's permission story is mode-based only:

```ts
// src/provider.ts:146 — buildRuntimeOptions()
return {
  cwd: this.settings.cwd ?? process.cwd(),
  sessionStore: createFileSessionStore({ stateDir }),
  agentRegistry: createAgentRegistry({ overrides: this.settings.agentRegistryOverrides }),
  permissionMode: (this.settings.permissionMode ?? DEFAULT_PERMISSION_MODE) as ...,
  nonInteractivePermissions: (this.settings.nonInteractivePermissions ?? DEFAULT_NON_INTERACTIVE) as ...,
  timeoutMs: this.settings.turnTimeoutMs,
  mcpServers: this.settings.mcpServers as AcpRuntimeOptions['mcpServers'],
}
```

The README has a "Known limitations" entry that documents this:

> **Permissions are mode-based, not callback-based.** No per-call user prompt — pick `approve-all`, `approve-reads`, or `deny-all` up front.

This plan removes that limitation.

### How ACP per-call permissions actually work on the wire

(Background only — the `acpx` runtime handles all of this; you don't touch the protocol directly.)

ACP agents (codex, claude, …) emit a `requestPermission` JSON-RPC notification when they want to do something risky. The host's `ClientSideConnection` wires that to `handlePermissionRequest`, which today delegates to `resolvePermissionRequest(params, mode, nonInteractivePolicy)` — a synchronous mode-based decision tree.

The upstream `acpx` change adds a callback hook: when `onPermissionRequest` is set, the runtime calls it before falling through to the mode-based resolver. If the callback returns `undefined`, the runtime continues with the existing logic (so existing consumers see no behavior change).

Our job here is purely: **pass the option through.** No wire-level work, no decision-mapping logic — that all lives upstream.

## Plan

Three small file edits, one README update, two test cases. Total surface ≈ 80 lines of code + ~30 lines of docs. Self-contained — no other parts of the package change.

### Step 1 — Re-export the new types from `acpx/runtime`

**File:** `packages/acpx-ai-provider/src/types.ts`

The package already re-exports a flat list of acpx types at the bottom (`AcpRuntime`, `AcpRuntimeHandle`, etc.) so consumers don't need to reach into `acpx/runtime` themselves. Add the three new types alongside:

```ts
import type {
  AcpPermissionDecision,        // ← NEW
  AcpPermissionRequest,         // ← NEW
  AcpRuntime,
  AcpRuntimeDoctorReport,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeTurnResult,
  AcpRuntimeTurnResultError,
} from 'acpx/runtime'
```

…and at the bottom of the file:

```ts
export type {
  AcpPermissionDecision,        // ← NEW
  AcpPermissionRequest,         // ← NEW
  AcpRuntime,
  AcpRuntimeDoctorReport,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeTurnResult,
  AcpRuntimeTurnResultError,
}
```

If upstream names differ (e.g. `AcpPermissionDecisionOutcome` vs `AcpPermissionDecision`), match the upstream names exactly — re-exporting doesn't transform.

### Step 2 — Add `onPermissionRequest` to `AcpxProviderSettings`

Same file (`packages/acpx-ai-provider/src/types.ts`). Extend the settings interface:

```ts
export interface AcpxProviderSettings {
  agent: string
  cwd?: string
  sessionKey?: string
  sessionMode?: AcpxSessionMode
  permissionMode?: AcpxPermissionMode
  nonInteractivePermissions?: AcpxNonInteractivePermissions
  mcpServers?: AcpxMcpServerConfig[]
  agentRegistryOverrides?: Record<string, string>
  stateDir?: string
  resumeSessionId?: string
  turnTimeoutMs?: number
  runtime?: AcpRuntime
  /**
   * Async callback invoked when the agent issues a per-call permission
   * request (e.g. write, shell, delete). Return a decision to gate the
   * call with host UI. Return `undefined` to fall through to the
   * existing `permissionMode` + `nonInteractivePermissions` logic.
   *
   * The callback is invoked while the agent is paused mid-turn waiting
   * for the JSON-RPC response — resolve quickly or honor the abort
   * signal so the agent doesn't hang.
   *
   * Note: this option is *only* honored when `runtime` is left
   * undefined (so the provider builds its own runtime). When the host
   * passes a pre-built `runtime`, the callback must be set on that
   * runtime directly.
   */
  onPermissionRequest?: (
    req: AcpPermissionRequest,
    ctx: { signal: AbortSignal },
  ) => Promise<AcpPermissionDecision | undefined>
  _internal?: {
    generateId?: () => string
    now?: () => Date
  }
}
```

Order it next to the other permission-related options (`permissionMode`, `nonInteractivePermissions`) for readability. The doc comment is important — call out the runtime-injection caveat explicitly.

### Step 3 — Pass it through in `buildRuntimeOptions`

**File:** `packages/acpx-ai-provider/src/provider.ts`

In the `buildRuntimeOptions()` method (currently around line 146), add one line:

```ts
private buildRuntimeOptions(): AcpRuntimeOptions {
  const stateDir = this.settings.stateDir ?? path.join(os.homedir(), '.acpx')
  return {
    cwd: this.settings.cwd ?? process.cwd(),
    sessionStore: createFileSessionStore({ stateDir }),
    agentRegistry: createAgentRegistry({
      overrides: this.settings.agentRegistryOverrides,
    }),
    permissionMode: (this.settings.permissionMode ??
      DEFAULT_PERMISSION_MODE) as AcpRuntimeOptions['permissionMode'],
    nonInteractivePermissions: (this.settings.nonInteractivePermissions ??
      DEFAULT_NON_INTERACTIVE) as AcpRuntimeOptions['nonInteractivePermissions'],
    timeoutMs: this.settings.turnTimeoutMs,
    mcpServers: this.settings.mcpServers as AcpRuntimeOptions['mcpServers'],
    onPermissionRequest: this.settings.onPermissionRequest,  // ← NEW
  }
}
```

That's the entire functional change. The runtime handles everything else.

**Do not** add fallback-or-translate logic here — that belongs in the runtime. The provider's job is plumbing only. If `this.settings.onPermissionRequest` is `undefined`, the runtime sees `undefined` and falls through to mode-based logic. If it's defined, the runtime invokes it.

### Step 4 — Re-export from the package entry

**File:** `packages/acpx-ai-provider/src/index.ts`

Add the two new types to the existing re-export block (currently around line 28–43):

```ts
export type {
  AcpPermissionDecision,    // ← NEW
  AcpPermissionRequest,     // ← NEW
  AcpRuntime,
  AcpRuntimeDoctorReport,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeTurnResult,
  AcpRuntimeTurnResultError,
  AcpxLanguageModelOptions,
  AcpxMcpServerConfig,
  AcpxMcpServerHttp,
  AcpxMcpServerStdio,
  AcpxNonInteractivePermissions,
  AcpxPermissionMode,
  AcpxProviderSettings,
  AcpxSessionMode,
} from './types.ts'
```

Sorted alphabetically to match the existing convention.

### Step 5 — Update the README

**File:** `packages/acpx-ai-provider/README.md`

Two edits:

**(a)** Replace the "Permissions are mode-based, not callback-based" bullet under "Known limitations / Inherited from acpx/runtime" (currently around line 236):

```diff
- - **Permissions are mode-based, not callback-based.** No per-call
-   user prompt — pick `approve-all`, `approve-reads`, or `deny-all` up
-   front.
+ - **Permission policy is mode-based by default.** When you don't
+   provide an `onPermissionRequest` callback, requests fall through
+   to `permissionMode` + `nonInteractivePermissions` — same as
+   before. Hosts wanting per-call gating should set the callback
+   (see "Per-call permissions" below).
```

**(b)** Add a new section after "Tools — via MCP servers", before "Structured output (JSON)":

```markdown
## Per-call permissions

By default, every permission request the agent issues (write a file,
run a shell command, delete, etc.) is resolved by the up-front
`permissionMode` setting. To intercept individual requests with your
own UI, pass an `onPermissionRequest` callback:

\`\`\`ts
const provider = createAcpxProvider({
  agent: 'codex',
  cwd: '/path/to/repo',
  permissionMode: 'approve-reads',           // fallback for unhandled cases
  onPermissionRequest: async (req, { signal }) => {
    // The agent is paused mid-turn waiting for your decision.
    // Honor `signal` so a turn cancel doesn't leave it hanging.
    const decision = await myUi.prompt({
      title: req.raw.toolCall.title,
      kind: req.inferredKind,        // 'edit' | 'shell' | 'delete' | …
      args: req.raw.toolCall.input,
    })
    return decision
    // Returning `undefined` falls through to the mode-based resolver.
  },
})
\`\`\`

The callback receives:

| Field | Meaning |
|---|---|
| `req.sessionId` | ACP session id (handy for multi-session hosts) |
| `req.raw` | Full original `RequestPermissionRequest` from the ACP SDK |
| `req.inferredKind` | One of `'read' \| 'search' \| 'edit' \| 'delete' \| 'move' \| 'execute' \| 'fetch' \| 'think' \| 'other'` — best-effort classification from the tool's title |
| `ctx.signal` | Aborts when the turn is cancelled or the session closes |

Return one of:

- `{ outcome: 'approve_once' }` — approve this single call.
- `{ outcome: 'approve_always' }` — approve this kind for the rest of the turn.
- `{ outcome: 'deny' }` — agent receives a denial and continues with the rest of its task.
- `{ outcome: 'cancel' }` — agent treats the call as cancelled (often ends the turn).
- `undefined` — fall through to the mode-based resolver.

**Important caveats:**

- The callback is invoked **only** when the provider builds its own runtime. If you pass a pre-built `runtime` via the `runtime` setting, set `onPermissionRequest` on that runtime instead.
- Throwing inside the callback falls through to mode-based logic and is logged by the runtime. Don't let UI errors take the whole turn down.
- The agent is **paused** until your promise resolves. There's no timeout enforced by the provider — wire your own (or rely on the agent's internal timeout, typically 5–10 minutes).
```

Adjust the "Recommended starting matrix" table per-agent column if the upstream change altered behavior (it shouldn't — opt-in option).

### Step 6 — Tests

**File:** `packages/acpx-ai-provider/test/unit/provider.test.ts` (new file if it doesn't exist; otherwise extend)

The provider already has tests for option propagation. Add cases that verify the new option flows through to `createAcpRuntime`. Mock `acpx/runtime` minimally — no need to spawn a real agent.

Test cases:

1. **Callback flows through** — when `onPermissionRequest` is set on `AcpxProviderSettings`, it appears in the `AcpRuntimeOptions` passed to `createAcpRuntime`.
2. **Undefined when not set** — when `onPermissionRequest` is omitted, `AcpRuntimeOptions.onPermissionRequest` is `undefined` (so the runtime knows to fall through).
3. **Pre-built runtime path** — when a `runtime` is provided, `createAcpRuntime` is **not** called and the callback isn't auto-attached to the pre-built runtime (documented behavior; host must wire it themselves).

Sketch:

```ts
import { describe, expect, mock, test } from 'bun:test'

const createAcpRuntimeMock = mock()

mock.module('acpx/runtime', () => ({
  createAcpRuntime: createAcpRuntimeMock,
  createAgentRegistry: () => ({}),
  createFileSessionStore: () => ({}),
}))

import { createAcpxProvider } from '../../src/provider.ts'

describe('AcpxProvider — onPermissionRequest', () => {
  test('forwards callback into AcpRuntimeOptions', () => {
    const cb = async () => undefined
    const provider = createAcpxProvider({ agent: 'codex', onPermissionRequest: cb })
    void provider.runtime  // force lazy build
    expect(createAcpRuntimeMock).toHaveBeenCalledTimes(1)
    expect(createAcpRuntimeMock.mock.calls[0]?.[0].onPermissionRequest).toBe(cb)
  })

  test('omitted when not set', () => {
    const provider = createAcpxProvider({ agent: 'codex' })
    void provider.runtime
    expect(createAcpRuntimeMock.mock.calls.at(-1)?.[0].onPermissionRequest).toBeUndefined()
  })

  test('skips runtime build when pre-built runtime is provided', () => {
    const fakeRuntime = { ensureSession: async () => ({}) } as unknown as AcpRuntime
    const cb = async () => undefined
    const provider = createAcpxProvider({
      agent: 'codex',
      runtime: fakeRuntime,
      onPermissionRequest: cb,
    })
    expect(provider.runtime).toBe(fakeRuntime)
    expect(createAcpRuntimeMock).not.toHaveBeenCalled()
  })
})
```

Run the existing test suite to make sure nothing else broke:

```bash
bun test
```

### Step 7 — Optional smoke test (E2E)

If easy: extend `test/e2e/smoke.test.ts` with a case that registers `onPermissionRequest` against a real agent (claude or codex) and asserts the callback fires when the agent runs a mutating tool. Skip if it requires network/auth in CI.

If the existing E2E suite has an env-gated mode (`SMOKE_AGENTS=all bun test test/e2e`), guard the new case the same way.

### Step 8 — Bump the version

**File:** `packages/acpx-ai-provider/package.json`

```diff
- "version": "0.0.1",
+ "version": "0.1.0",
```

Justification: additive public API surface (new optional setting, new exported types) — minor bump in alpha lane. The peer dep on `acpx` may also need a lower bound update if the upstream change shipped as a minor; check `node_modules/acpx/package.json` and update:

```diff
   "peerDependencies": {
-    "acpx": ">=0.6.1",
+    "acpx": ">=0.7.0",       // or whatever version landed the runtime callback
     "ai": ">=6.0.0"
   },
```

If the version constant in `src/index.ts` is also pinned (`export const VERSION = '0.0.0'`), bump that too.

### Step 9 — CHANGELOG (if the repo uses one)

The monorepo's `cliff.toml` suggests git-cliff drives changelogs from conventional commits. Use a conventional commit message:

```
feat(acpx-ai-provider): add onPermissionRequest callback option

Hosts can now intercept the agent's per-call permission requests
with their own UI by passing `onPermissionRequest` to
`createAcpxProvider`. Returning `undefined` falls through to the
existing mode-based resolver, so existing consumers see no
behavior change.

Driven by downstream BrowserOS chat work that wants inline
approve/deny CTA cards instead of an up-front mode gate.
```

git-cliff will generate the CHANGELOG entry automatically on release.

## Implementation Details

### File-level shape after the change

```
packages/acpx-ai-provider/
├── src/
│   ├── types.ts                  ← + AcpPermissionRequest / AcpPermissionDecision
│   │                               re-exports + onPermissionRequest in
│   │                               AcpxProviderSettings
│   ├── provider.ts               ← +1 line in buildRuntimeOptions()
│   ├── index.ts                  ← + 2 type re-exports
│   └── (others unchanged)
├── test/
│   └── unit/
│       └── provider.test.ts      ← NEW (or extended) — 3 test cases
├── README.md                     ← updated "Known limitations" + new
│                                   "Per-call permissions" section
└── package.json                  ← version bump + peer dep range
```

Roughly: 4 files touched, 1 file new (test), ~80 lines of code + ~50 lines of docs.

### Why `onPermissionRequest` is on `AcpxProviderSettings`, not `AcpxLanguageModelOptions`

`AcpxLanguageModelOptions` is the per-call options bag passed to `provider.languageModel(modelId, opts)` — used for things that vary per language-model invocation (`sessionKey`, `agent`, `mode`). The permission callback is bound to the *runtime* (which is constructed once per provider) — moving it to the per-call options would require rebuilding the runtime for every model instance, defeating the persistent-session model. Keep it on the settings.

### Why throwing in the callback should fall through, not fail the turn

If the host's UI errors (e.g. the user closes the tab during a permission decision and our event-emitter throws), failing the whole agent turn is hostile. The mode-based fallback gives a sensible second-line behavior. The runtime already implements this fall-through — we're documenting and relying on it.

### What you don't need to do

- **No decision-to-wire-format mapping** — the runtime translates `AcpPermissionDecision` → `RequestPermissionResponse` (selecting the right `optionId` from the agent's offered options). Don't reinvent this.
- **No timeout/cancellation handling** — the runtime forwards `ctx.signal` from the session's abort controller. The host honors it; we don't intermediate.
- **No new `AcpxProvider` methods** — purely settings plumbing.
- **No language-model.ts changes** — the permission flow is between runtime and host, never visible to the AI SDK message stream.

### Risks

| Risk | Mitigation |
|---|---|
| Upstream `acpx` types differ from what's documented above | Re-read `node_modules/acpx/dist/runtime.d.ts` after install; align the re-exports + setting to match. The README example needs updating in lockstep. |
| Existing consumers update without setting the callback | Behavior is unchanged — `undefined` falls through. README's diff makes this explicit. |
| Pre-built runtime path lets the callback silently no-op | Doc-comment on the setting calls this out; test case asserts the no-op. We could log a warning when both `runtime` and `onPermissionRequest` are set — out of scope for v1. |
| AI SDK's message stream doesn't carry permission events through | Not relevant — the permission flow is host-runtime, never crosses into the AI SDK pipeline. The host emits its own UI signals separately. |

## Output

- This plan file at `plans/2026-05-06-1830-on-permission-request-callback.md`
- One PR to `DaniAkash/acpx`, branch `feat/on-permission-request-callback`
- Published as `acpx-ai-provider@0.1.0` (alpha minor bump)

## Notes

- This is a single-PR change — all six steps go together. Don't ship the type re-exports without the runtime plumbing.
- The driving consumer (BrowserOS) is also building an in-flight permission registry on their side — that work is independent and lands separately. They block on this package shipping.
- Out of scope for this plan but worth flagging for the upstream `acpx` work: the host might want richer kind classification ("apply_patch on a file under cwd" vs "shell command in a workspace"). v1 inferred-kind is fine; richer signals can come later via additive fields on `AcpPermissionRequest`.
- The README update is the user-visible contract for this change. Take the time to make the example clear — the consumer experience is "read README → 30 seconds to wire up". A long-form callback doc is more valuable than an extra test.

## Outcomes

_To be filled during execution._
