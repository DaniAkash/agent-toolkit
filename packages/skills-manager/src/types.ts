import type { AgentType } from './_vendor/types.ts'

export type AgentId = AgentType

export interface AgentInfo {
  id: AgentId
  displayName: string
  /**
   * Where this agent looks for skills (absolute path). For agents that
   * advertise both a per-workspace and a global skills dir, this is the
   * global one.
   */
  defaultSkillsDir: string
  /** True iff the agent's home directory exists on disk. */
  installed: boolean
}

export type SystemPromptOption = string | { append: string }

export type SkillSource =
  | { kind: 'github'; ownerRepo: string; ref?: string }
  | { kind: 'gitUrl'; url: string; ref?: string }
  | { kind: 'local'; path: string }

export interface SkillsManagerOptions {
  /**
   * Workspace directory — the canonical store where the original SKILL.md
   * bundles live. Defaults to `~/.skills`. Created on demand.
   */
  workspaceDir?: string
  /**
   * Override the default skills directory for one or more agents. Useful
   * for project-scoped installs, non-standard agent layouts, and tests.
   * Anything not overridden falls back to the built-in catalog
   * (`resolveAgentSkillsDir(agent)`).
   */
  agentSkillsDirs?: Partial<Record<AgentId, string>>
}

export interface AddSkillOptions {
  /** Raw user input — parsed into a `SkillSource`. */
  source: string
  /**
   * Subset of skill names to add (for sources containing multiple
   * SKILL.md bundles). Omit (or pass `'*'`) for all.
   */
  skillNames?: string[] | '*'
  /**
   * For local sources only: copy the SKILL.md bundle into the workspace
   * (default `'copy'`) or symlink it. Symlinks let you iterate on a skill
   * without re-running `add()`.
   */
  localMode?: 'symlink' | 'copy'
}

export interface AddSkillResult {
  added: Array<{ name: string; workspacePath: string; description: string }>
  skipped: Array<{ name: string; reason: string }>
  failed: Array<{ name: string; error: string }>
}

export interface LinkSkillOptions {
  skillName: string
  agent: AgentId
  /** Override the agent's default skills directory. */
  agentSkillsDir?: string
}

export interface LinkSkillResult {
  skillName: string
  agent: AgentId
  linkPath: string
  /** False if a correctly-pointing link already existed (idempotent path). */
  created: boolean
}

export interface UnlinkSkillOptions {
  skillName: string
  agent: AgentId
  agentSkillsDir?: string
}

export interface UnlinkSkillResult {
  linkPath: string
  /** False if no link was present, the path was foreign, or the link was unmanaged. */
  removed: boolean
  /** True when `removed === false` because the path is a non-symlink we won't touch. */
  foreign?: boolean
  /** True when `removed === false` because the link exists but the manifest doesn't record it. */
  unmanaged?: boolean
}

export interface RemoveSkillOptions {
  skillName: string
}

export interface ListSkillsOptions {
  /**
   * Default false. When true, also report workspace directories that
   * contain a SKILL.md but aren't in the manifest, as `unmanaged: true`.
   */
  scanUnmanaged?: boolean
}

export interface ListLinksOptions {
  /** Filter to a subset of agents. Default: every agent the manifest tracks. */
  agents?: AgentId[]
  /** Filter to a subset of skill names. Default: every link in the manifest. */
  skillNames?: string[]
  /**
   * Default false. When true, also walk each agent's skills directory
   * for symlinks-into-workspace that the manifest doesn't record, and
   * report them as `unmanaged: true`.
   */
  scanUnmanaged?: boolean
}

export interface SkillLink {
  /**
   * Sanitized workspace directory name — the lookup key for `unlink()`,
   * `removeWithLinks()`, etc. Round-trips: `unlink({ skillName })` will
   * re-sanitize, so passing this value back works.
   */
  skillName: string
  /**
   * Frontmatter `name` recorded at `add()` / `link()` time. Display
   * value. For unmanaged links, falls back to the on-disk directory
   * name since no manifest entry exists.
   */
  name: string
  agent: AgentId
  /** Path of the symlink itself, inside the agent's skills directory. */
  linkPath: string
  /**
   * The workspace path the link points at. For healthy entries this is
   * the recorded manifest target, verified against `readlink`. For
   * broken entries this is the recorded (now stale) target. For
   * unmanaged entries this is the resolved target read from disk.
   */
  workspacePath: string
  /**
   * True when the manifest recorded this link but verification failed:
   * the symlink is missing, points elsewhere, or its target bundle is
   * gone.
   */
  broken?: boolean
  /**
   * True when the symlink exists on disk and resolves into the workspace
   * but the manifest does not record it. `unlink()` refuses to remove
   * unmanaged entries; use `rescan({ mode: 'merge' })` to adopt them.
   */
  unmanaged?: boolean
}

export interface InstalledSkill {
  name: string
  description: string
  workspacePath: string
  /** Where the bundle came from. Missing for unmanaged + pre-source-tracking entries. */
  source?: SkillSource
  /** ISO timestamp of when `add()` recorded this entry. */
  addedAt?: string
  /** True when manifest has the entry but SKILL.md is missing on disk. */
  broken?: boolean
  /** True when the workspace dir exists but the manifest doesn't track it. */
  unmanaged?: boolean
}

export interface SkillManifest {
  version: 1
  /** Keyed by sanitized directory name. */
  skills: Record<string, ManifestSkillEntry>
}

export interface ManifestSkillEntry {
  name: string
  description: string
  source: SkillSource
  addedAt: string
  links: Partial<Record<AgentId, ManifestLinkEntry>>
}

export interface ManifestLinkEntry {
  linkPath: string
  workspacePath: string
  createdAt: string
}

export interface RescanOptions {
  /**
   * 'merge' (default): preserve existing manifest metadata for entries
   * the scan rediscovers; add fresh entries for what it finds on disk.
   * 'replace': discard the existing manifest and seed from disk only —
   * destructive of source-URL / addedAt metadata.
   */
  mode?: 'merge' | 'replace'
}

export interface RescanResult {
  /** Skill dirs the scan found and added to the manifest. */
  adopted: string[]
  /** Skill dirs the scan found that were already in the manifest. */
  preserved: string[]
  /** Manifest entries dropped because the bundle no longer exists. */
  removed: string[]
  /** Agent links the scan found and added or refreshed. */
  linksAdopted: Array<{ skillName: string; agent: AgentId; linkPath: string }>
}
