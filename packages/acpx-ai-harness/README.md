# acpx-ai-harness

A Vercel AI SDK v7 `HarnessV1` adapter built on the [acpx](https://www.npmjs.com/package/acpx) runtime. Brings any ACP-protocol agent (Claude Code, Codex, Gemini, Copilot, Cursor) into the [AI SDK Harnesses](https://ai-sdk.dev/v7/docs/ai-sdk-harnesses/overview) ecosystem alongside `@ai-sdk/harness-claude-code`, `@ai-sdk/harness-codex`, and `@ai-sdk/harness-pi`.

> **Experimental.** Both this package and the upstream `@ai-sdk/harness` API are pre-1.0 and subject to breaking changes.

## Status

Under active construction. The public API and examples will land as the implementation progresses.

## Install

```bash
npm install acpx-ai-harness @ai-sdk/harness ai acpx
```

`acpx-ai-harness` declares `@ai-sdk/harness`, `ai`, and `acpx` as peer dependencies, so the consumer pins them.

## License

MIT
