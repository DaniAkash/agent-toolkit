import { HarnessCapabilityUnsupportedError } from '@ai-sdk/harness'
import { DEFAULT_PUBLIC_HOSTNAME } from './settings.ts'

/** Single port mapping known to the resolver. */
export interface ResolvedPort {
  /** Host-side port number (the one returned by `ports` on the session). */
  readonly port: number
  /** Bind address chosen at sandbox-create time. */
  readonly bind: string
}

const UNSPECIFIED_BIND = new Set(['0.0.0.0', '::'])

/**
 * Wrap IPv6 literals in `[...]` per RFC 3986; pass IPv4 and hostnames
 * through unchanged. Heuristic: any host containing `:` is treated as IPv6.
 */
function formatHostForUrl(host: string): string {
  if (host.includes(':')) return `[${host}]`
  return host
}

/**
 * Resolve host-port URLs for a sandbox. Owned by the network sandbox session
 * — there's one resolver per session, constructed from the settings the
 * provider used to spin up the sandbox.
 */
export class PortResolver {
  private readonly byPort: Map<number, ResolvedPort>
  private readonly hostname: string

  constructor(input: {
    ports: ReadonlyArray<ResolvedPort>
    publicHostname?: string
    providerId: string
  }) {
    this.byPort = new Map(input.ports.map((p) => [p.port, p]))
    // Treat empty / whitespace-only publicHostname as unset to avoid emitting
    // URLs like `http://:9090`.
    const trimmed = input.publicHostname?.trim()
    this.hostname =
      trimmed && trimmed.length > 0 ? trimmed : DEFAULT_PUBLIC_HOSTNAME
    this.providerId = input.providerId
  }

  readonly providerId: string

  /** Ordered host-side port numbers as declared in settings. */
  ports(originalOrder: ReadonlyArray<ResolvedPort>): ReadonlyArray<number> {
    return originalOrder.map((p) => p.port)
  }

  resolve(options: {
    port: number
    protocol?: 'http' | 'https' | 'ws'
  }): string {
    const entry = this.byPort.get(options.port)
    if (!entry) {
      throw new HarnessCapabilityUnsupportedError({
        harnessId: this.providerId,
        message: `Port ${options.port} is not exposed on this sandbox. Exposed ports: [${[...this.byPort.keys()].join(', ')}].`,
      })
    }
    const host = UNSPECIFIED_BIND.has(entry.bind) ? this.hostname : entry.bind
    const scheme =
      options.protocol === 'https'
        ? 'https'
        : options.protocol === 'ws'
          ? 'ws'
          : 'http'
    return `${scheme}://${formatHostForUrl(host)}:${entry.port}`
  }
}
