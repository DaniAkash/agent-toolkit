# ai-sdk-microsandbox

A Vercel AI SDK v7 `HarnessV1SandboxProvider` backed by [microsandbox](https://github.com/superradcompany/microsandbox). Drop-in replacement for `@ai-sdk/sandbox-vercel` at the `sandbox:` slot of `HarnessAgent`, running coding agents in local microVM isolation instead of Vercel's hosted infrastructure.

## Status

Pre-release. The provider implementation is landing across a sequence of releases. Check the [open issues](https://github.com/DaniAkash/acpx/issues) for what's already shipping and what's coming next.

## Target adapters

Designed to pair with the official Vercel-shipped HarnessV1 adapters:

- [`@ai-sdk/harness-claude-code`](https://ai-sdk.dev/v7/docs/ai-sdk-harnesses/harness-adapters#claude-code)
- [`@ai-sdk/harness-codex`](https://ai-sdk.dev/v7/docs/ai-sdk-harnesses/harness-adapters#codex)
- [`@ai-sdk/harness-pi`](https://ai-sdk.dev/v7/docs/ai-sdk-harnesses/harness-adapters#pi)

## Requirements

When the implementation lands, the host machine running the SDK consumer process will need either:

- Linux with KVM enabled, or
- macOS on Apple Silicon

These are microsandbox's own runtime requirements.

## License

MIT. See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for attribution.
