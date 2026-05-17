# acpx

Tooling for the [Agent Client Protocol](https://agentclientprotocol.com) on top of [`acpx`](https://www.npmjs.com/package/acpx).

This is a Bun-managed monorepo. Packages live under [`packages/`](./packages).

## Packages

| Package | Description |
|---|---|
| [`acpx-ai-provider`](./packages/acpx-ai-provider) | Vercel AI SDK provider on top of `acpx/runtime`. One install, any ACP agent (Claude, Codex, Gemini, Copilot, Cursor, Pi, …). |
| [`agent-skills-manager`](./packages/agent-skills-manager) | Programmatic workspace + agent-link manager for skills following the [agentskills.io specification](https://agentskills.io/specification). Manifest-driven `add` / `link` / `unlink` / `listSkills` / `listLinks` / `rescan` primitives. |
| [`acp-probe`](./packages/acp-probe) | Probe any ACP-compatible agent for its capabilities — models, modes, configOptions, prompt capabilities, auth methods, MCP transports — via a single typed `probeAgent({ command })` call. No real prompt sent; no token cost. |

## Development

Requires [Bun](https://bun.sh) ≥ 1.3.

```bash
bun install
bun run typecheck
bun run lint
bun test
bun run build
```

## Tooling

- [**Bun**](https://bun.sh) — package manager, test runner, workspace orchestrator
- [**Bunup**](https://bunup.dev) — library bundler for `packages/*`
- [**Biome**](https://biomejs.dev) — formatter + linter
- [**Fallow**](https://docs.fallow.tools) — codebase intelligence: unused code, circular deps, package boundary enforcement

## License

MIT © Dani Akash
