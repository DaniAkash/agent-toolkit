import type { HarnessV1NetworkPolicy } from '@ai-sdk/harness'
import type { Sandbox } from 'microsandbox'

/**
 * Default host hostname used when no `publicHostname` is configured.
 * Matches the loopback bind that microsandbox uses by default.
 */
export const DEFAULT_PUBLIC_HOSTNAME = '127.0.0.1'

export interface MicrosandboxPortSetting {
  /** Host-side port (the externally-reachable side of the mapping). */
  readonly host: number
  /** Guest-side port inside the microVM. */
  readonly guest: number
  /**
   * Host bind address. Defaults to `127.0.0.1`. Use `0.0.0.0` to expose the
   * port on all host interfaces; the resulting URL then uses `publicHostname`.
   */
  readonly bind?: string
  /** TCP (default) or UDP. */
  readonly protocol?: 'tcp' | 'udp'
}

export interface MicrosandboxCreateSettings {
  readonly sandbox?: never
  /** OCI image reference or local path. Required for create mode. */
  readonly image: string
  /** Optional name override; the provider generates one if absent. */
  readonly name?: string
  readonly cpus?: number
  /** Guest memory in MiB. */
  readonly memory?: number
  /** Default working directory inside the guest. */
  readonly workdir?: string
  /** Port mappings to publish. */
  readonly ports?: ReadonlyArray<MicrosandboxPortSetting>
  /** Environment variables set in the guest. */
  readonly env?: Record<string, string>
  /**
   * Harness-shaped network policy. Translated to microsandbox's policy grammar
   * at create-time. Build-time only — microsandbox does not support runtime
   * updates.
   */
  readonly networkPolicy?: HarnessV1NetworkPolicy
  /**
   * Hostname returned by `getPortUrl` for ports bound to `0.0.0.0` / `::`.
   * Defaults to `127.0.0.1`. Loopback-bound ports always use their bind
   * address regardless of this setting.
   */
  readonly publicHostname?: string
  /**
   * Replace an existing sandbox with the same name. `true` uses the default
   * grace period; an object specifies an explicit SIGTERM-to-SIGKILL timeout.
   */
  readonly replace?: boolean | { readonly timeoutMs: number }
}

export interface MicrosandboxWrapSettings {
  /**
   * Pre-built microsandbox `Sandbox` the provider wraps. Lifecycle stays with
   * the caller — `stop()` and `destroy()` are no-ops on sessions sourced from
   * this Sandbox.
   */
  readonly sandbox: Sandbox
  /** Port pool the provider can lease from for concurrent sessions. */
  readonly bridgePorts?: ReadonlyArray<number>
  /** Same `publicHostname` semantics as create mode. */
  readonly publicHostname?: string
}

export type MicrosandboxSettings =
  | MicrosandboxCreateSettings
  | MicrosandboxWrapSettings

export type MicrosandboxSettingsErrorCode =
  | 'MISSING_IMAGE'
  | 'INVALID_CPUS'
  | 'INVALID_MEMORY'
  | 'INVALID_PORT'
  | 'DUPLICATE_PORT'
  | 'INVALID_NAME'

export class MicrosandboxSettingsError extends Error {
  override readonly name = 'MicrosandboxSettingsError'

  constructor(
    readonly code: MicrosandboxSettingsErrorCode,
    message: string,
  ) {
    super(message)
  }
}

// Published ports must be a real, addressable port — port 0 would generate
// unusable URLs (`http://...:0`) downstream from `getPortUrl`. Reject up front.
const PORT_MIN = 1
const PORT_MAX = 65535

// Microsandbox sandbox names are limited to 128 UTF-8 bytes; longer strings
// fail inside the NAPI binding rather than at our boundary. Pre-check so
// callers get a typed error from `MicrosandboxSettingsError`.
const MAX_SANDBOX_NAME_BYTES = 128

function isCreateSettings(
  settings: MicrosandboxSettings,
): settings is MicrosandboxCreateSettings {
  return !('sandbox' in settings && settings.sandbox != null)
}

function validatePort(port: number, side: 'host' | 'guest'): void {
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new MicrosandboxSettingsError(
      'INVALID_PORT',
      `${side} port ${port} is out of range (${PORT_MIN}..=${PORT_MAX})`,
    )
  }
}

/**
 * Validate settings and throw a {@link MicrosandboxSettingsError} on the first
 * invariant violation. Idempotent: calling it twice on the same object is
 * safe.
 */
export function validateMicrosandboxSettings(
  settings: MicrosandboxSettings,
): void {
  if (!isCreateSettings(settings)) {
    // Wrap mode — sandbox is provided. Nothing else to validate here;
    // bridgePorts/publicHostname are optional and have safe defaults.
    return
  }
  validateImage(settings.image)
  validateName(settings.name)
  validatePositiveInteger(settings.cpus, 'INVALID_CPUS', 'cpus')
  validatePositiveInteger(settings.memory, 'INVALID_MEMORY', 'memory (MiB)')
  validatePorts(settings.ports)
}

function validateImage(image: unknown): void {
  if (!image || typeof image !== 'string') {
    throw new MicrosandboxSettingsError(
      'MISSING_IMAGE',
      'create-mode settings require a non-empty `image` field',
    )
  }
}

function validateName(name: string | undefined): void {
  if (name === undefined) return
  if (typeof name !== 'string' || name.length === 0) {
    throw new MicrosandboxSettingsError(
      'INVALID_NAME',
      'name must be a non-empty string',
    )
  }
  const byteLength = Buffer.byteLength(name, 'utf8')
  if (byteLength > MAX_SANDBOX_NAME_BYTES) {
    throw new MicrosandboxSettingsError(
      'INVALID_NAME',
      `name exceeds the ${MAX_SANDBOX_NAME_BYTES} UTF-8 byte limit (got ${byteLength})`,
    )
  }
}

function validatePositiveInteger(
  value: number | undefined,
  code: MicrosandboxSettingsErrorCode,
  label: string,
): void {
  if (value === undefined) return
  if (!Number.isInteger(value) || value < 1) {
    throw new MicrosandboxSettingsError(
      code,
      `${label} must be a positive integer; got ${value}`,
    )
  }
}

function validatePorts(
  ports: ReadonlyArray<MicrosandboxPortSetting> | undefined,
): void {
  if (!ports) return
  const seen = new Set<number>()
  for (const entry of ports) {
    validatePort(entry.host, 'host')
    validatePort(entry.guest, 'guest')
    if (seen.has(entry.host)) {
      throw new MicrosandboxSettingsError(
        'DUPLICATE_PORT',
        `duplicate host port ${entry.host}`,
      )
    }
    seen.add(entry.host)
  }
}

/** Type-guard: are these create-mode settings? Exported for the provider. */
export function isMicrosandboxCreateSettings(
  settings: MicrosandboxSettings,
): settings is MicrosandboxCreateSettings {
  return isCreateSettings(settings)
}
