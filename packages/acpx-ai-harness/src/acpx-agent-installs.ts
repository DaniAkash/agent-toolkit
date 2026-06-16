/**
 * Per-agent install commands the bootstrap recipe runs inside the sandbox.
 *
 * The harness owns this so consumers don't have to wire a custom
 * `onSandboxSession` hook just to put the CLI on PATH. Each command is run
 * once per snapshot identity (Vercel sandbox keys snapshots by the recipe
 * hash, so the install cost is amortised across sessions).
 *
 * Agents without an entry here aren't installed by the bootstrap. The
 * consumer remains free to install them via the framework's
 * `onSandboxSession` hook for any agent the harness doesn't know about,
 * or to bake them into a custom sandbox image.
 *
 * Each agent reads its auth credential from an env var at run time:
 *   - codex   → OPENAI_API_KEY
 *   - claude  → ANTHROPIC_API_KEY
 *   - gemini  → GEMINI_API_KEY
 *
 * The harness does not forward these — they need to be in the sandbox's
 * env at creation time (e.g. `createVercelSandbox({ env: {...} })`).
 */
export const ACPX_AGENT_INSTALL_COMMANDS: Readonly<Record<string, string>> = {
  codex: 'npm install -g @openai/codex',
  claude: 'npm install -g @anthropic-ai/claude-code',
  gemini: 'npm install -g @google/gemini-cli',
}

export function installCommandForAgent(agent: string): string | undefined {
  return ACPX_AGENT_INSTALL_COMMANDS[agent]
}
