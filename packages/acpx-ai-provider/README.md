# acpx-ai-provider

> Vercel AI SDK provider on top of [`acpx/runtime`](https://www.npmjs.com/package/acpx).
> One install, any ACP agent — Claude Code, Codex, Gemini, Copilot, Cursor, Pi, and more.

[![npm](https://img.shields.io/npm/v/acpx-ai-provider.svg)](https://www.npmjs.com/package/acpx-ai-provider)

## Status

Early scaffolding. Implementation in progress.

## Why

The existing [`acp-ai-provider`](https://github.com/mcpc-tech/mcpc/tree/main/packages/acp-ai-provider) bridges Vercel AI SDK to the Agent Client Protocol via the bare `@agentclientprotocol/sdk`. That works, but consumers still have to install each agent's CLI separately and write their own `{ command, args }` spawn config.

`acpx-ai-provider` sits one level higher — on top of `acpx/runtime` — so:

- Zero extra installs. `acpx` resolves and `npx`-spawns built-in agents (Claude, Codex, Gemini, Copilot, Cursor, Pi, etc.) on first use.
- No stdio plumbing, no init handshake, no auth retry loops, no permission dialog wiring. The runtime owns all of that.
- The provider is a thin translation layer between AI SDK's `LanguageModelV2` and `AcpRuntime`'s normalized event stream.

## Install

```bash
bun add acpx-ai-provider acpx ai
```

## Usage

_Coming soon._

## License

MIT © Dani Akash
