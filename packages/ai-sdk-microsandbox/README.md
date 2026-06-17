# ai-sdk-microsandbox

A Vercel AI SDK v7 `HarnessV1SandboxProvider` backed by [microsandbox](https://github.com/superradcompany/microsandbox). Drop-in replacement for `@ai-sdk/sandbox-vercel` at the `sandbox:` slot of `HarnessAgent`, running coding agents in local microVM isolation instead of Vercel's hosted infrastructure.

## Status

Alpha. The provider runs end-to-end against the official `@ai-sdk/harness-codex` and `@ai-sdk/harness-claude-code` adapters; track issues for changes ahead of the first stable release.

## Why

`HarnessAgent` needs a sandbox provider. The official `@ai-sdk/sandbox-vercel` provider runs each session in a hosted Vercel sandbox. `ai-sdk-microsandbox` does the same job using a microVM that runs locally on your machine, so the bridge, the agent CLI, and any files the agent touches stay on-host. No external account or per-session billing; no network round trip to a provider for I/O; agents resume across processes via the same on-disk snapshot cache.

## Install

```bash
npm install ai-sdk-microsandbox @ai-sdk/harness @ai-sdk/harness-codex ai
# microsandbox is a peer dependency; install on the host:
npm install microsandbox
```

## Quickstart

```ts
import { HarnessAgent } from '@ai-sdk/harness/agent'
import { createCodex } from '@ai-sdk/harness-codex'
import { createMicrosandbox } from 'ai-sdk-microsandbox'

const agent = new HarnessAgent({
  harness: createCodex({
    auth: { openai: { apiKey: process.env.OPENAI_API_KEY } },
  }),
  sandbox: createMicrosandbox({
    image: 'node:22-bookworm-slim',
    cpus: 2,
    memory: 2048,
    workdir: '/workspace',
    ports: [{ host: 4000, guest: 4000 }],
  }),
})

const session = await agent.createSession()
try {
  const result = await agent.generate({
    session,
    prompt: 'Use bash to create /workspace/hi.txt containing "hello".',
  })
  console.log(result.text)
} finally {
  await session.destroy()
}
```

## Requirements

- **Linux** with KVM enabled, **or**
- **macOS** on Apple Silicon

Both are microsandbox's own runtime prerequisites. Run `microsandbox setup` once on the host before using the provider.

## Settings

`createMicrosandbox(settings)` accepts either create-mode settings (provider mints a fresh microVM per session) or wrap-mode settings (provider wraps a caller-owned microVM).

### Create-mode settings

| Field | Type | Default | Notes |
|---|---|---|---|
| `image` | `string` | required | OCI image reference or local path. |
| `cpus` | `number` | microsandbox default | Guest CPU count. |
| `memory` | `number` | microsandbox default | Guest memory in MiB. |
| `workdir` | `string` | `/` | Default working directory inside the guest. |
| `ports` | `MicrosandboxPortSetting[]` | `[]` | Host → guest port mappings. Bridge-backed harnesses need at least one. |
| `env` | `Record<string,string>` | `{}` | Env vars set in the guest. |
| `networkPolicy` | `HarnessV1NetworkPolicy` | `allow-all` | Outbound network rules. Build-time only. |
| `name` | `string` | auto-generated | Sandbox name override. |
| `publicHostname` | `string` | `127.0.0.1` | Hostname used by `getPortUrl` for `0.0.0.0`-bound ports. |
| `replace` | `boolean \| { timeoutMs }` | `false` | Replace an existing sandbox of the same name on boot. |

Port settings:

```ts
{ host: 4000, guest: 4000, bind?: '127.0.0.1', protocol?: 'tcp' }
```

### Wrap-mode settings

| Field | Type | Notes |
|---|---|---|
| `sandbox` | `microsandbox.Sandbox` | Caller-owned `Sandbox`. Lifecycle stays with the caller. |
| `bridgePorts` | `number[]` | Port pool the provider can lease for bridge-backed harnesses. |
| `publicHostname` | `string` | Same semantics as create mode. |

In wrap mode the provider never calls `Sandbox.builder()` or `Sandbox.start()` directly. `stop()` / `destroy()` on the resulting sessions are no-ops.

## Network policy

The provider translates the harness `HarnessV1NetworkPolicy` into microsandbox's `NetworkPolicyBuilder` at create-time. Runtime policy updates are not supported.

```ts
createMicrosandbox({
  image: '…',
  networkPolicy: { mode: 'deny-all' }, // or 'allow-all'
})

createMicrosandbox({
  image: '…',
  networkPolicy: {
    mode: 'custom',
    allowedHosts: ['api.openai.com'],
    deniedCIDRs: ['169.254.169.254/32'], // takes precedence
  },
})
```

## Cross-process resume

Each create-mode session is backed by a named microVM. After `agent.createSession({ sessionId })`, you can later resume that exact sandbox in a new process by calling `agent.createSession({ sessionId, resumeFrom })` with the resume state returned from `session.stop()` or `session.detach()`. The provider stores a filesystem-level snapshot cache so the bootstrap recipe is reused across processes for matching identities.

Cache root resolution:

1. `AI_SDK_MICROSANDBOX_CACHE_DIR` env override, if set
2. OS-conventional cache directory (`~/.cache/ai-sdk-microsandbox` on Linux, `~/Library/Caches/ai-sdk-microsandbox` on macOS, `%LOCALAPPDATA%\ai-sdk-microsandbox` on Windows)

## Comparison

| Provider | Where sessions run | Best for |
|---|---|---|
| `@ai-sdk/sandbox-vercel` | Vercel-hosted micro-sandboxes | Hosted production; you want sandboxes to outlive your process |
| `@ai-sdk/sandbox-just-bash` | Local host shell | Local trust boundary acceptable; no port exposure |
| **`ai-sdk-microsandbox`** | Local microVMs (KVM / Apple Silicon) | Local isolation + cross-process resume without leaving the machine |

## Limitations

- KVM (Linux) or Apple Silicon required. No Windows host support; no x86 macOS support.
- Runtime network policy updates are unavailable. Policy is sealed at create-time.
- Snapshot pruning is manual today. Old templates accumulate under the cache root; remove the directory tree to reset.
- Snapshots are local-machine-only. They are not synced to a registry.
- This package is alpha. The exported API may change before `1.0.0`.

## Testing

Three suites, gated by environment:

```bash
bun test                            # unit only (default; mocked)
MICROSANDBOX_INTEGRATION=1 \
  bun run test:integration          # real microVM, no agent involved
MICROSANDBOX_INTEGRATION=1 \
  OPENAI_API_KEY=sk-… \
  bun run test:e2e                  # real Codex agent against real OpenAI
```

The e2e suite shares one bootstrapped snapshot across files: the first test pays the cost of installing the Codex CLI in the microVM; subsequent tests fork from the snapshot in ~1s. Expected per-run OpenAI cost on `gpt-5-codex-mini` is well under one US dollar.

## License

MIT. See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for attribution.
