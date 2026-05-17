// Vendored from vercel-labs/skills@1.5.6 src/types.ts. See THIRD_PARTY_NOTICES.md
// for upstream attribution. Trimmed to the subset agent-skills-manager actually uses.

export type AgentType =
  | 'aider-desk'
  | 'amp'
  | 'antigravity'
  | 'augment'
  | 'bob'
  | 'claude-code'
  | 'openclaw'
  | 'cline'
  | 'codearts-agent'
  | 'codebuddy'
  | 'codemaker'
  | 'codestudio'
  | 'codex'
  | 'command-code'
  | 'continue'
  | 'cortex'
  | 'crush'
  | 'cursor'
  | 'deepagents'
  | 'devin'
  | 'dexto'
  | 'droid'
  | 'firebender'
  | 'forgecode'
  | 'gemini-cli'
  | 'github-copilot'
  | 'goose'
  | 'hermes-agent'
  | 'iflow-cli'
  | 'junie'
  | 'kilo'
  | 'kimi-cli'
  | 'kiro-cli'
  | 'kode'
  | 'mcpjam'
  | 'mistral-vibe'
  | 'mux'
  | 'neovate'
  | 'opencode'
  | 'openhands'
  | 'pi'
  | 'qoder'
  | 'qwen-code'
  | 'replit'
  | 'roo'
  | 'rovodev'
  | 'tabnine-cli'
  | 'trae'
  | 'trae-cn'
  | 'warp'
  | 'windsurf'
  | 'zencoder'
  | 'pochi'
  | 'adal'
  | 'universal'

export interface AgentConfig {
  name: string
  displayName: string
  skillsDir: string
  /** Global skills directory. Set to undefined if the agent doesn't support global installation. */
  globalSkillsDir: string | undefined
  detectInstalled: () => Promise<boolean>
  /** Whether to show this agent in the universal agents list. Defaults to true. */
  showInUniversalList?: boolean
}
