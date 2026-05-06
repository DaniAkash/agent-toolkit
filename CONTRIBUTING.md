# Contributing to `acpx`

Thanks for your interest. This monorepo houses
[`acpx-ai-provider`](./packages/acpx-ai-provider) — a Vercel AI SDK
provider built on top of [`acpx/runtime`](https://www.npmjs.com/package/acpx).
Both this package and the underlying runtime are pre-1.0; the most
useful contributions right now are bug reports, real-world usage
notes, and PRs that close gaps in the
[Known limitations](./packages/acpx-ai-provider/README.md#known-limitations)
list.

## Quick start

Requires [Bun](https://bun.sh) ≥ 1.3 (the version is pinned in
[`.bun-version`](./.bun-version)). Node isn't required to develop —
the toolchain is Bun-first — though the published package runs fine
on Node ≥ 20.

```bash
git clone https://github.com/DaniAkash/acpx
cd acpx
bun install

bun run typecheck
bun run lint
bun run fallow
bun test
bun run build
```

All five must be green before opening a PR. CI runs the same five
checks as a final gate.

## Project layout

```
acpx/
├── packages/
│   └── acpx-ai-provider/        the only published package today
│       ├── src/                 LanguageModelV2 + provider implementation
│       │   ├── index.ts         public exports
│       │   ├── provider.ts      AcpxProvider — runtime lifecycle, session cache
│       │   ├── language-model.ts AcpxLanguageModel — doStream / doGenerate
│       │   ├── convert-prompt.ts AI SDK prompt → acpx { text, attachments }
│       │   ├── convert-events.ts EventTranslator state machine
│       │   ├── json-output.ts   markdown-fence cleanup TransformStream
│       │   ├── errors.ts        AcpxError hierarchy + fromRuntimeError
│       │   └── types.ts         AcpxProviderSettings + re-exports
│       └── test/
│           ├── unit/            pure-function tests (convert-prompt,
│           │                    convert-events, json-output, errors)
│           ├── integration/     provider + mock runtime, plus tests
│           │                    that drive through ai's streamText /
│           │                    generateText
│           ├── contract/        compile-time + runtime checks against
│           │                    the LanguageModelV2 interface
│           ├── helpers/         MockAcpRuntime, event/result builders,
│           │                    re-exports of @ai-sdk/provider-utils/test
│           └── e2e/             gated smoke tests against real agents
├── .github/workflows/           CI + release
├── biome.json                   lint + format config
├── .fallowrc.json               codebase intelligence config
├── tsconfig.json                strict TypeScript baseline
├── bunfig.toml                  1-day npm release-age gate (project-scoped)
├── cliff.toml                   git-cliff release-notes config
└── package.json                 monorepo root (private)
```

## Development workflow

### Branches and commits

- Branch from `main`. Use [Conventional Branch](https://conventional-branch.github.io/)
  names — `feat/foo`, `fix/bar`, `chore/baz`, `docs/qux`, `test/zap`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for
  every commit message. The release workflow groups commits into
  release notes by their type, so non-conforming commits are silently
  excluded from the changelog.
- **Never include AI attribution** (e.g. `Co-Authored-By:
  Claude/GPT/etc.`, "Generated with Claude Code", any badge or
  footer) in commit messages, PR descriptions, or code comments.
- **Don't reference local-only paths** (`~/workbench`, `plans/...`,
  `memory/...`) in anything visible on GitHub.

### Running checks

Each can be run individually while iterating; CI runs them all.

| Command | What it does |
|---|---|
| `bun run typecheck` | `tsc --noEmit` across every workspace |
| `bun run lint` | `biome check` — lint + formatter + import organizer |
| `bun run lint:fix` | `biome check --write --unsafe` — auto-applies all fixes |
| `bun run fallow` | codebase intelligence: dead code, circular deps, boundary violations |
| `bun test` | unit + integration + contract suite (180+ tests, ~150ms) |
| `bun run build` | `bunup` — emits ESM + .d.ts in `packages/acpx-ai-provider/dist` |

### Smoke tests (gated)

Real-runtime tests against `claude`, `codex`, and `gemini` live under
[`packages/acpx-ai-provider/test/e2e/`](./packages/acpx-ai-provider/test/e2e/README.md).
Skipped by default. Run before tagging a release:

```bash
bun run test:smoke              # all three agents
SMOKE_AGENTS=claude bun test test/e2e   # one agent
```

Per-agent setup (auth keys, agent CLI installation) is documented in
[`test/e2e/README.md`](./packages/acpx-ai-provider/test/e2e/README.md).

## Test strategy

Tests are organized into four layers, each catching a different
class of bug. New `src/` code should land alongside new tests in the
appropriate layer:

1. **Unit (`test/unit/`)** — pure functions only. Translation tables,
   state machines, error mapping. Fast and exhaustive: every row of
   the translation table has a dedicated test.
2. **Integration (`test/integration/`)** — `AcpxProvider` +
   `AcpxLanguageModel` driven against `MockAcpRuntime`. Covers
   session lifecycle, abort signal threading, error paths, runtime
   injection, JSON cleanup pipeline.
3. **Contract (`test/contract/`)** — compile-time
   `AcpxLanguageModel extends LanguageModelV2` assertion plus
   runtime sanity checks on the static fields. Goes red the day AI
   SDK ships a breaking interface change.
4. **End-to-end (`test/e2e/`)** — gated, real-runtime smoke tests.
   Catch the things the mock harness can't: `npx` agent download
   drift, agent CLI version skew, env auth wiring, real session
   persistence on disk, real JSON output behavior.

Coverage targets that aren't strictly enforced but worth aiming for:

- 100 % of `AcpRuntimeEvent` variants have a dedicated translator test
- 100 % of stop-reason mappings have a dedicated test
- 100 % of public methods on `AcpxProvider` / `AcpxLanguageModel`
  have at least one test
- ≥ 90 % branch coverage on `convert-events.ts` and `json-output.ts`

## Pull request guidelines

- Open PRs against `main`. CI is gated by a manual approval (the
  `ci-approval` environment) — that's not a comment on your work, it's
  a guard against fork PRs spending CI minutes uninvited.
- One concern per PR. PRs that mix a feature, a refactor, and a
  doc rewrite are hard to review.
- Every `src/` PR must ship its own tests in the same diff.
- Run all five local checks before pushing. CI surfaces *every*
  failure in one run (each step uses `if: !cancelled()`), so a single
  push can fix everything if you missed a check locally.
- Use Conventional Comments for code-review comments:
  `<label> [decorations]: <subject>`. Labels: `praise`, `nitpick`,
  `suggestion`, `issue`, `todo`, `question`, `thought`, `chore`,
  `note`. `(blocking)` / `(non-blocking)` decorations signal merge
  intent. See <https://conventionalcomments.org/>.

## Inspirations and references

This project stands on others' shoulders. If you're touching code in
one of these areas, the references will help orient you:

- **[`@mcpc/acp-ai-provider`](https://github.com/mcpc-tech/mcpc/tree/main/packages/acp-ai-provider)**
  — the original AI SDK ↔ ACP bridge, sitting one layer lower (on
  raw `@agentclientprotocol/sdk`). We ported the role-prefix prompt
  serialization, the markdown-fence cleanup logic, and the entire
  JSON-output test suite from this package. Their `tools` /
  TCP-callback story is the gold-standard reference for the
  host-side-tools work tracked in our limitations list.
- **[Vercel AI SDK](https://github.com/vercel/ai)** — specifically
  `packages/ai/src/test/mock-language-model-v3.ts`. Our
  [`MockAcpRuntime`](./packages/acpx-ai-provider/test/helpers/mock-acp-runtime.ts)
  is modeled directly on its constructor pattern (record calls;
  accept scriptable `doStream`/`doGenerate` results). The
  `convertArrayToReadableStream` /
  `convertReadableStreamToArray` helpers from
  `@ai-sdk/provider-utils/test` are re-exported through
  [`test/helpers/streams.ts`](./packages/acpx-ai-provider/test/helpers/streams.ts)
  for stream assertions.
- **[`acpx/runtime`](https://github.com/openclaw/acpx)** — the
  runtime we sit on. `AcpRuntime`, `AcpRuntimeEvent`,
  `AcpRuntimeTurn`, the agent registry, the file-backed session
  store. Many quirks in our package are inherited from this layer
  (see [Known limitations](./packages/acpx-ai-provider/README.md#known-limitations)).
- **[`DaniAkash/agent-terminal`](https://github.com/DaniAkash/agent-terminal)**
  — the CI workflow's manual-approval gate, the
  `if: ${{ !cancelled() }}` per-step pattern (so one CI run surfaces
  every failure), and the tag-triggered git-cliff draft-release
  pattern all come from there. `cliff.toml` is a near-direct port.

## Reporting issues

Bugs, feature requests, and questions: <https://github.com/DaniAkash/acpx/issues>.

When filing a bug:

1. Include the package version (`acpx-ai-provider` and `acpx`).
2. Include the agent id you were using (`claude` / `codex` /
   `gemini` / etc.).
3. Include a minimal reproduction. The smaller it is, the faster
   it gets diagnosed.
4. Note whether the failure reproduces against the mock runtime
   (use `MockAcpRuntime` from `test/helpers/`) or only against the
   real agent — that tells us where in the stack to look.

## License

By contributing, you agree that your contributions will be licensed
under the project's [MIT License](./LICENSE).
