/**
 * Per-agent install commands the bootstrap recipe runs inside the sandbox.
 *
 * acpx invokes a specific ACP-protocol wrapper binary for each agent (see
 * acpx's README's "Built-ins" table for the canonical mapping). For the
 * agents that need a separately-installed wrapper, we pre-warm the npx
 * cache during bootstrap so the first turn doesn't pay the fetch cost.
 * Agents whose wrapper is the agent CLI itself (gemini, qwen, kiro, ...)
 * still need that CLI on PATH; for those we run `npm install -g`.
 *
 * Each install command is run once per snapshot identity (Vercel sandbox
 * keys snapshots by the recipe hash), so the cost is amortised across
 * sessions.
 *
 * Agents without an entry here aren't installed by the bootstrap. The
 * consumer can wire a custom `onSandboxSession` hook on `HarnessAgent`
 * to install one we don't know about, or bake it into a custom sandbox
 * image.
 *
 * Auth credentials are NOT in this table; the harness handles them via
 * `AcpxHarnessSettings.auth` (writes `~/.acpx/config.json` per session)
 * and the acpx adapter reads them from there at turn time.
 */
export const ACPX_AGENT_INSTALL_COMMANDS: Readonly<Record<string, string>> = {
  // codex-acp: ACP wrapper over the OpenAI Codex SDK (per acpx README).
  // npx --yes pre-warms the cache so the first turn doesn't fetch.
  // The binary only accepts `--help` / `-h` (no `--version` flag), so
  // `--help` is the only no-side-effect smoke test we can run here.
  // Output is discarded to keep bootstrap logs clean.
  codex: 'npx --yes @zed-industries/codex-acp --help > /dev/null',
  // claude-agent-acp: ACP wrapper over Claude Code (per acpx README).
  claude:
    'npx --yes @agentclientprotocol/claude-agent-acp --version || npm install -g @anthropic-ai/claude-code',
  // gemini ships ACP natively (`gemini --acp`); install the CLI.
  gemini: 'npm install -g @google/gemini-cli',
}

export function installCommandForAgent(agent: string): string | undefined {
  return ACPX_AGENT_INSTALL_COMMANDS[agent]
}
