import { commonTool } from '@ai-sdk/harness'
import { z } from 'zod/v4'

/**
 * Built-in tools exposed by ACP agents, declared with the standard harness
 * common-tool schemas so they're recognised across the harness ecosystem.
 *
 * The map is keyed by common-tool names. Per-agent native names (Claude Code's
 * `Read`/`Bash`, Codex's `read`/`shell`, Gemini's variants) are normalised
 * inside the bridge before events leave the sandbox, so consumers always see
 * the common names on the wire.
 *
 * `nativeName` is set to the common name as the default; the bridge overrides
 * it via the `nativeName` field on `tool-call` events when the underlying
 * agent's wire name differs from the common name.
 */
export const ACPX_BUILTIN_TOOLS = {
  read: commonTool('read', {
    nativeName: 'read',
    toolUseKind: 'readonly',
    description: 'Read file contents.',
    inputSchema: z.object({ file_path: z.string() }),
  }),
  write: commonTool('write', {
    nativeName: 'write',
    toolUseKind: 'edit',
    description: 'Write content to a file.',
    inputSchema: z.object({ file_path: z.string(), content: z.string() }),
  }),
  edit: commonTool('edit', {
    nativeName: 'edit',
    toolUseKind: 'edit',
    description: 'Edit a file by replacing text.',
    inputSchema: z.object({
      file_path: z.string(),
      old_string: z.string(),
      new_string: z.string(),
    }),
  }),
  bash: commonTool('bash', {
    nativeName: 'bash',
    toolUseKind: 'bash',
    description: 'Execute a shell command.',
    inputSchema: z.object({ command: z.string() }),
  }),
  grep: commonTool('grep', {
    nativeName: 'grep',
    toolUseKind: 'readonly',
    description: 'Search file contents with a regex pattern.',
    inputSchema: z.object({ pattern: z.string() }),
  }),
  glob: commonTool('glob', {
    nativeName: 'glob',
    toolUseKind: 'readonly',
    description: 'Find files matching a glob pattern.',
    inputSchema: z.object({ pattern: z.string() }),
  }),
  webSearch: commonTool('webSearch', {
    nativeName: 'web_search',
    toolUseKind: 'readonly',
    description: 'Search the web.',
    inputSchema: z.object({ query: z.string() }),
  }),
} as const
