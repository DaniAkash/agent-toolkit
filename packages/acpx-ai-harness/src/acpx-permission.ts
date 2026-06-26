import type { HarnessV1PermissionMode } from '@ai-sdk/harness'

/**
 * acpx's permission modes accepted by `AcpxProviderSettings.permissionMode`.
 *
 * Mirrored here to avoid coupling the harness's host surface to acpx's
 * internal types (the bridge owns the real conversion).
 */
export type AcpxPermissionMode = 'approve-all' | 'approve-reads' | 'deny-all'

/**
 * 1:1 mapping from harness permission modes to acpx permission modes.
 *
 * `allow-edits` maps to acpx's `approve-all` because acpx does not ship a
 * dedicated edits bucket; `approve-all` covers everything edits implies.
 */
export function harnessPermissionModeToAcpx(
  mode: HarnessV1PermissionMode | undefined,
): AcpxPermissionMode {
  switch (mode) {
    case 'allow-reads':
      return 'approve-reads'
    case 'allow-edits':
    case 'allow-all':
    case undefined:
      return 'approve-all'
  }
}
