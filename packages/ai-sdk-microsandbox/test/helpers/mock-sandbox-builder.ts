import type { SandboxBuilder } from 'microsandbox'

/**
 * Recorded call entry for the mock builder. Captures the method name and a
 * representative subset of its arguments so tests can assert on order +
 * payloads without depending on the real microsandbox NAPI signature.
 */
export type RecordedBuilderCall =
  | { method: 'image'; image: string }
  | { method: 'fromSnapshot'; snapshotName: string }
  | { method: 'cpus'; cpus: number }
  | { method: 'memory'; mib: number }
  | { method: 'workdir'; path: string }
  | { method: 'envs'; env: Record<string, string> }
  | { method: 'replace' }
  | { method: 'replaceWithTimeout'; timeoutMs: number }
  | { method: 'port'; host: number; guest: number }
  | { method: 'portBind'; bind: string; host: number; guest: number }
  | { method: 'portUdp'; host: number; guest: number }
  | { method: 'portUdpBind'; bind: string; host: number; guest: number }
  | { method: 'network' }
  | { method: 'create' }

/**
 * Structural stub matching the subset of microsandbox `SandboxBuilder` the
 * settings-application path calls. Each method returns `this` to support
 * the SDK's fluent chain. `.create()` resolves to a placeholder Sandbox-like
 * object so the chain terminates.
 */
export class MockSandboxBuilder {
  readonly calls: RecordedBuilderCall[] = []

  image(image: string): this {
    this.calls.push({ method: 'image', image })
    return this
  }

  fromSnapshot(snapshotName: string): this {
    this.calls.push({ method: 'fromSnapshot', snapshotName })
    return this
  }

  cpus(cpus: number): this {
    this.calls.push({ method: 'cpus', cpus })
    return this
  }

  memory(mib: number): this {
    this.calls.push({ method: 'memory', mib })
    return this
  }

  workdir(path: string): this {
    this.calls.push({ method: 'workdir', path })
    return this
  }

  envs(env: Record<string, string>): this {
    this.calls.push({ method: 'envs', env: { ...env } })
    return this
  }

  replace(): this {
    this.calls.push({ method: 'replace' })
    return this
  }

  replaceWithTimeout(timeoutMs: number): this {
    this.calls.push({ method: 'replaceWithTimeout', timeoutMs })
    return this
  }

  port(host: number, guest: number): this {
    this.calls.push({ method: 'port', host, guest })
    return this
  }

  portBind(bind: string, host: number, guest: number): this {
    this.calls.push({ method: 'portBind', bind, host, guest })
    return this
  }

  portUdp(host: number, guest: number): this {
    this.calls.push({ method: 'portUdp', host, guest })
    return this
  }

  portUdpBind(bind: string, host: number, guest: number): this {
    this.calls.push({ method: 'portUdpBind', bind, host, guest })
    return this
  }

  network(_configure: unknown): this {
    this.calls.push({ method: 'network' })
    return this
  }

  async create(): Promise<unknown> {
    this.calls.push({ method: 'create' })
    return { name: 'mock-built' }
  }

  asSandboxBuilder(): SandboxBuilder {
    return this as unknown as SandboxBuilder
  }
}
