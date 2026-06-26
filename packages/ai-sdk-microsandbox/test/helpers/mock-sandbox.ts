import type { ExecEvent } from 'microsandbox'

export interface MockExecResult {
  /** Exit code returned via `output.code`. */
  readonly code?: number
  /** Text returned by `output.stdout()`. */
  readonly stdout?: string
  /** Text returned by `output.stderr()`. */
  readonly stderr?: string
}

export interface MockExecStreamScript {
  readonly events?: readonly ExecEvent[]
  readonly waitCode?: number
  readonly killThrows?: Error
}

export interface MockSandboxOptions {
  readonly name?: string
  /** path → bytes; map entries with value `undefined` simulate ENOENT. */
  readonly fsReads?: ReadonlyMap<string, Uint8Array | undefined>
  /** path → error to throw when writing that path. */
  readonly fsWriteErrors?: ReadonlyMap<string, Error>
  /** Throw this error from `fs().mkdir(path)`. */
  readonly fsMkdirError?: Error
  /** Queue of exec outputs consumed by `execWith` calls in FIFO order. */
  readonly execResults?: readonly MockExecResult[]
  /** Queue of exec stream scripts consumed by `execStreamWith` calls in FIFO order. */
  readonly execStreams?: readonly MockExecStreamScript[]
  /** Object returned by `config()` — matches microsandbox's camelCase shape. */
  readonly config?: Record<string, unknown>
  /** Throw this error from `stop()`. */
  readonly stopError?: Error
}

export interface MockExecOptions {
  args?: readonly string[]
  cwd?: string
  env?: Record<string, string>
}

export interface MockExecCall {
  readonly cmd: string
  readonly args: readonly string[]
  readonly cwd: string | undefined
  readonly env: Record<string, string> | undefined
}

/**
 * Minimal builder mirroring microsandbox's NAPI `ExecOptionsBuilder` so the
 * production code paths exercise the same `.args(...).cwd(...).env(...)`
 * chain shape. We only model the subset of setters the session class touches.
 */
export class MockExecOptionsBuilder {
  private readonly state: MockExecOptions = {}

  args(args: readonly string[]): this {
    Object.defineProperty(this.state, 'args', {
      value: [...args],
      enumerable: true,
    })
    return this
  }

  cwd(cwd: string): this {
    Object.defineProperty(this.state, 'cwd', { value: cwd, enumerable: true })
    return this
  }

  envs(env: Record<string, string>): this {
    Object.defineProperty(this.state, 'env', {
      value: { ...env },
      enumerable: true,
    })
    return this
  }

  build(): MockExecOptions {
    return this.state
  }
}

/**
 * Mirrors microsandbox's `ExecOutput` shape: `code` is a property, `stdout`
 * and `stderr` are methods (the real class lazily decodes bytes on call).
 */
export class MockExecOutput {
  constructor(
    public readonly code: number,
    private readonly stdoutText: string,
    private readonly stderrText: string,
  ) {}

  stdout(): string {
    return this.stdoutText
  }

  stderr(): string {
    return this.stderrText
  }
}

/**
 * Minimal `ExecHandle`-shaped stub. Implements `AsyncIterable<ExecEvent>` so
 * the stream demuxer can consume it the same way it consumes a real handle.
 */
export class MockExecHandle implements AsyncIterable<ExecEvent> {
  pid: number | undefined
  killCalls = 0

  constructor(private readonly script: MockExecStreamScript) {
    const started = script.events?.find((e) => e.kind === 'started')
    this.pid = started?.pid
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ExecEvent> {
    for (const event of this.script.events ?? []) {
      yield event
    }
  }

  async wait(): Promise<{ code: number; success: boolean }> {
    const code = this.script.waitCode ?? 0
    return { code, success: code === 0 }
  }

  async kill(): Promise<void> {
    this.killCalls += 1
    if (this.script.killThrows) throw this.script.killThrows
  }
}

export class MockSandboxFsOps {
  constructor(
    private readonly opts: MockSandboxOptions,
    private readonly calls: {
      reads: string[]
      writes: Array<{ path: string; size: number }>
      mkdirs: string[]
    },
  ) {}

  async read(path: string): Promise<Uint8Array> {
    this.calls.reads.push(path)
    if (!this.opts.fsReads?.has(path)) {
      const err = new Error(`no such file: ${path}`) as Error & { code: string }
      err.code = 'NotFound'
      throw err
    }
    const value = this.opts.fsReads.get(path)
    if (value === undefined) {
      const err = new Error(`no such file: ${path}`) as Error & { code: string }
      err.code = 'NotFound'
      throw err
    }
    return value
  }

  async readToString(path: string): Promise<string> {
    const bytes = await this.read(path)
    return new TextDecoder().decode(bytes)
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    const error = this.opts.fsWriteErrors?.get(path)
    if (error) throw error
    const bytes =
      typeof data === 'string' ? new TextEncoder().encode(data) : data
    this.calls.writes.push({ path, size: bytes.byteLength })
  }

  async mkdir(path: string): Promise<void> {
    this.calls.mkdirs.push(path)
    if (this.opts.fsMkdirError) throw this.opts.fsMkdirError
  }
}

export interface MockSandboxCalls {
  readonly fsReads: readonly string[]
  readonly fsWrites: ReadonlyArray<{ path: string; size: number }>
  readonly fsMkdirs: readonly string[]
  readonly execs: readonly MockExecCall[]
  readonly execStreams: readonly MockExecCall[]
}

/**
 * Stub matching the subset of `microsandbox.Sandbox` that
 * `MicrosandboxSandboxSession` calls. Lives in this package (not in
 * `acpx-test-helpers`) because the mocked surface is microsandbox-specific.
 *
 * Type-level shape contract: see `mock-sandbox.test.ts` for the `satisfies`
 * assertion that this class structurally matches the real `Sandbox` for the
 * methods the session uses.
 */
export class MockSandbox {
  readonly name: string
  private readonly opts: MockSandboxOptions
  private readonly callsInternal = {
    reads: [] as string[],
    writes: [] as Array<{ path: string; size: number }>,
    mkdirs: [] as string[],
    execs: [] as MockExecCall[],
    execStreams: [] as MockExecCall[],
  }
  private execIndex = 0
  private execStreamIndex = 0

  constructor(opts: MockSandboxOptions = {}) {
    this.opts = opts
    this.name = opts.name ?? 'mock-sandbox'
  }

  get calls(): MockSandboxCalls {
    return {
      fsReads: this.callsInternal.reads,
      fsWrites: this.callsInternal.writes,
      fsMkdirs: this.callsInternal.mkdirs,
      execs: this.callsInternal.execs,
      execStreams: this.callsInternal.execStreams,
    }
  }

  fs(): MockSandboxFsOps {
    return new MockSandboxFsOps(this.opts, this.callsInternal)
  }

  async execWith(
    cmd: string,
    configure: (b: MockExecOptionsBuilder) => MockExecOptionsBuilder,
  ): Promise<MockExecOutput> {
    const built = configure(new MockExecOptionsBuilder()).build()
    this.callsInternal.execs.push({
      cmd,
      args: built.args ?? [],
      cwd: built.cwd,
      env: built.env,
    })
    const result = this.opts.execResults?.[this.execIndex]
    this.execIndex += 1
    return new MockExecOutput(
      result?.code ?? 0,
      result?.stdout ?? '',
      result?.stderr ?? '',
    )
  }

  async execStreamWith(
    cmd: string,
    configure: (b: MockExecOptionsBuilder) => MockExecOptionsBuilder,
  ): Promise<MockExecHandle> {
    const built = configure(new MockExecOptionsBuilder()).build()
    this.callsInternal.execStreams.push({
      cmd,
      args: built.args ?? [],
      cwd: built.cwd,
      env: built.env,
    })
    const script = this.opts.execStreams?.[this.execStreamIndex] ?? {}
    this.execStreamIndex += 1
    return new MockExecHandle(script)
  }

  async config(): Promise<Record<string, unknown>> {
    return this.opts.config ?? {}
  }

  stopCalls = 0
  async stop(): Promise<void> {
    this.stopCalls += 1
    if (this.opts.stopError) throw this.opts.stopError
  }
}
