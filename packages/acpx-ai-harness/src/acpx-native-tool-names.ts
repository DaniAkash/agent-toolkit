import type { HarnessV1BuiltinToolName } from '@ai-sdk/harness'

/**
 * Per-agent mapping from a native tool name (as the underlying ACP agent
 * emits it on the wire) to the common-tool name the harness ecosystem uses.
 *
 * Tools an agent exposes but the common vocabulary doesn't standardise pass
 * through unchanged — see {@link toCommonToolName}.
 */
export const NATIVE_TO_COMMON_BY_AGENT: Readonly<
  Record<string, Readonly<Record<string, HarnessV1BuiltinToolName>>>
> = {
  claude: {
    Read: 'read',
    Write: 'write',
    Edit: 'edit',
    Bash: 'bash',
    Grep: 'grep',
    Glob: 'glob',
    WebSearch: 'webSearch',
  },
  codex: {
    read: 'read',
    write: 'write',
    edit: 'edit',
    shell: 'bash',
    grep: 'grep',
    glob: 'glob',
    web_search: 'webSearch',
  },
  gemini: {
    read_file: 'read',
    write_file: 'write',
    edit_file: 'edit',
    run_shell_command: 'bash',
    search_file_content: 'grep',
    glob: 'glob',
    google_web_search: 'webSearch',
  },
}

/**
 * Resolve an agent's native tool name to the common-tool name when one
 * exists, otherwise return the native name as-is so unmapped tools still
 * flow through. Unknown agents bypass the table.
 */
export function toCommonToolName(
  agent: string,
  nativeName: string,
): HarnessV1BuiltinToolName | string {
  return NATIVE_TO_COMMON_BY_AGENT[agent]?.[nativeName] ?? nativeName
}
