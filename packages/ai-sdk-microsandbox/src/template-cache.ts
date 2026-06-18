import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Experimental_SandboxSession } from '@ai-sdk/provider-utils'
import type { Sandbox } from 'microsandbox'
import { Sandbox as SandboxClass } from 'microsandbox'
import { atomicWriteIntoDirectory } from './internal/atomic-write.ts'
import { computeOptionsHash } from './internal/options-hash.ts'
import {
  applyCreateSettings,
  applyForkSettings,
} from './internal/sandbox-builder-apply.ts'
import {
  removeSnapshotIfExists as defaultRemoveSnapshotIfExists,
  snapshotExists as defaultSnapshotExists,
  stopAndSnapshot as defaultStopAndSnapshot,
} from './internal/snapshot-orchestration.ts'
import {
  resolveTemplateDirectory,
  resolveTemplatesDirectory,
} from './internal/template-paths.ts'
import type { SandboxBuilderFactory } from './microsandbox-provider.ts'
import { MicrosandboxSandboxSession } from './microsandbox-sandbox-session.ts'
import type { MicrosandboxCreateSettings } from './settings.ts'

/**
 * On-disk shape of `metadata.json`. Bump `VERSION` on any breaking schema
 * change — older files are treated as a cache miss.
 */
export interface TemplateMetadata {
  readonly version: 1
  readonly identity: string
  readonly snapshotName: string
  readonly optionsHash: string
  readonly createdAt: number
}

const METADATA_VERSION = 1
const METADATA_FILENAME = 'metadata.json'
const SNAPSHOT_PREFIX = 'ai-sdk-tpl'
const TEMPLATE_SANDBOX_PREFIX = 'ai-sdk-tpl-src'

/**
 * Snapshot-api seam. The default implementation forwards to microsandbox's
 * `Sandbox` / `Snapshot` static surface. Tests substitute a recorder.
 */
export interface SnapshotApi {
  stopAndSnapshot(sandboxName: string, snapshotName: string): Promise<void>
  snapshotExists(snapshotName: string): Promise<boolean>
  removeSnapshotIfExists(snapshotName: string): Promise<void>
}

export type OnFirstCreateFn = (
  session: Experimental_SandboxSession,
  opts: { abortSignal?: AbortSignal },
) => Promise<void>

export interface ResolveTemplateInput {
  readonly identity: string
  readonly settings: MicrosandboxCreateSettings
  readonly onFirstCreate: OnFirstCreateFn
  readonly builderFactory: SandboxBuilderFactory
  readonly abortSignal?: AbortSignal
}

export interface TemplateRecord {
  readonly snapshotName: string
  readonly optionsHash: string
}

export interface TemplateCacheOptions {
  /** Override the cache root. Defaults to the OS-conventional path. */
  readonly cacheRoot?: string
  /** Override the snapshot API. Defaults to microsandbox's static surface. */
  readonly snapshotApi?: SnapshotApi
}

const GLOBAL_CACHE_SYMBOL = Symbol.for(
  'ai-sdk-microsandbox.template-cache.inflight',
)

interface GlobalCache {
  inflight: Map<string, Promise<TemplateRecord>>
}

function getGlobalCache(): GlobalCache {
  const globalAny = globalThis as { [GLOBAL_CACHE_SYMBOL]?: GlobalCache }
  if (!globalAny[GLOBAL_CACHE_SYMBOL]) {
    globalAny[GLOBAL_CACHE_SYMBOL] = { inflight: new Map() }
  }
  return globalAny[GLOBAL_CACHE_SYMBOL]
}

/** Reset the global in-memory cache. Test-only. */
export function _resetTemplateCacheForTests(): void {
  const globalAny = globalThis as { [GLOBAL_CACHE_SYMBOL]?: GlobalCache }
  delete globalAny[GLOBAL_CACHE_SYMBOL]
}

/**
 * Two-layer snapshot template cache.
 *
 * - In-memory layer (process-global, symbol-anchored) holds in-flight
 *   Promises so concurrent `resolveTemplate(identity)` calls share one
 *   bootstrap pass.
 * - Filesystem layer (`<cacheRoot>/templates/<sha256(identity)>/metadata.json`)
 *   persists snapshot names across process restarts and is shared across
 *   processes pointing at the same cache root.
 *
 * Design adapted from `vercel/eve`'s microsandbox template orchestration —
 * see PR description for the source citations. Eve owns the orchestration
 * patterns; this class is a narrower implementation scoped to the
 * HarnessV1SandboxProvider contract.
 */
export class TemplateCache {
  private readonly templatesDir: string
  private readonly snapshotApi: SnapshotApi

  constructor(options: TemplateCacheOptions = {}) {
    this.templatesDir =
      options.cacheRoot !== undefined
        ? join(options.cacheRoot, 'templates')
        : resolveTemplatesDirectory()
    this.snapshotApi = options.snapshotApi ?? {
      stopAndSnapshot: defaultStopAndSnapshot,
      snapshotExists: defaultSnapshotExists,
      removeSnapshotIfExists: defaultRemoveSnapshotIfExists,
    }
  }

  /**
   * Resolve a snapshot template for the given identity. Cache hit returns
   * immediately; cache miss invokes `onFirstCreate` exactly once per
   * (identity, optionsHash) tuple across all concurrent callers in this
   * process. Keying the in-flight map by both prevents cross-settings
   * contamination when two providers with different settings happen to
   * share an identity string.
   */
  async resolveTemplate(input: ResolveTemplateInput): Promise<TemplateRecord> {
    input.abortSignal?.throwIfAborted()
    const optionsHash = computeOptionsHash(input.settings)
    const inflight = getGlobalCache().inflight
    const inflightKey = `${identityHash(input.identity)}:${optionsHash}`
    const existing = inflight.get(inflightKey)
    if (existing) return await existing

    const promise = this.materialiseTemplate({
      ...input,
      optionsHash,
    }).finally(() => {
      // Drop the in-flight handle when this attempt settles, win or lose.
      inflight.delete(inflightKey)
    })
    inflight.set(inflightKey, promise)
    return await promise
  }

  private async materialiseTemplate(input: {
    identity: string
    settings: MicrosandboxCreateSettings
    optionsHash: string
    onFirstCreate: OnFirstCreateFn
    builderFactory: SandboxBuilderFactory
    abortSignal?: AbortSignal
  }): Promise<TemplateRecord> {
    const templateDir = resolveTemplateDirectory(
      this.templatesDir,
      input.identity,
    )

    // Filesystem-layer hit?
    const cached = await this.readCachedMetadata(templateDir)
    if (
      cached &&
      cached.optionsHash === input.optionsHash &&
      (await this.snapshotApi.snapshotExists(cached.snapshotName))
    ) {
      return {
        snapshotName: cached.snapshotName,
        optionsHash: cached.optionsHash,
      }
    }

    // Miss — rebuild.
    input.abortSignal?.throwIfAborted()
    const snapshotName = deriveSnapshotName(input.identity, input.optionsHash)
    const templateSandboxName = deriveTemplateSandboxName(
      input.identity,
      input.optionsHash,
    )

    // Defensive cleanup in case a previous attempt orphaned a snapshot
    // under the same name.
    await this.snapshotApi.removeSnapshotIfExists(snapshotName)

    let templateSandbox: Sandbox | undefined
    try {
      const builder = applyCreateSettings(
        input.builderFactory(templateSandboxName),
        input.settings,
      )
      input.abortSignal?.throwIfAborted()
      templateSandbox = (await builder.create()) as Sandbox

      const restricted = new MicrosandboxSandboxSession(templateSandbox)
      input.abortSignal?.throwIfAborted()
      for (const command of input.settings.bootstrapPreCommands ?? []) {
        input.abortSignal?.throwIfAborted()
        const result = await restricted.run({
          command,
          abortSignal: input.abortSignal,
        })
        if (result.exitCode !== 0) {
          throw new Error(
            `bootstrapPreCommand failed (exit ${result.exitCode}): ${command}\nstderr: ${result.stderr}`,
          )
        }
      }
      input.abortSignal?.throwIfAborted()
      await input.onFirstCreate(restricted, {
        abortSignal: input.abortSignal,
      })

      input.abortSignal?.throwIfAborted()
      await this.snapshotApi.stopAndSnapshot(templateSandboxName, snapshotName)

      const metadata: TemplateMetadata = {
        version: METADATA_VERSION,
        identity: input.identity,
        snapshotName,
        optionsHash: input.optionsHash,
        createdAt: Date.now(),
      }
      await atomicWriteIntoDirectory({
        finalDir: templateDir,
        filename: METADATA_FILENAME,
        payload: JSON.stringify(metadata),
      })

      return { snapshotName, optionsHash: input.optionsHash }
    } catch (error) {
      // Best-effort: stop and remove the template sandbox so it doesn't
      // linger after a failed bootstrap. Microsandbox tracks the sandbox
      // record even when `builder.create()` fails late (e.g. workdir
      // validation), so a Sandbox.remove sweep is required on top of stop.
      // The snapshot (if any) is dropped too.
      await templateSandbox?.stop().catch(() => {})
      await SandboxClass.remove(templateSandboxName).catch(() => {})
      await this.snapshotApi
        .removeSnapshotIfExists(snapshotName)
        .catch(() => {})
      throw error
    }
  }

  private async readCachedMetadata(
    templateDir: string,
  ): Promise<TemplateMetadata | null> {
    try {
      const raw = await readFile(join(templateDir, METADATA_FILENAME), 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!isValidMetadata(parsed)) return null
      return parsed
    } catch {
      return null
    }
  }
}

/**
 * Create-mode helper for the provider: builds the fork's `SandboxBuilder`
 * from the resolved template's snapshot. Image is omitted (snapshot pins
 * it); all runtime settings (cpus / memory / workdir / env / ports /
 * networkPolicy) are reapplied.
 */
export function buildForkFromSnapshot(input: {
  builderFactory: SandboxBuilderFactory
  forkName: string
  snapshotName: string
  settings: MicrosandboxCreateSettings
}): ReturnType<SandboxBuilderFactory> {
  const builder = input
    .builderFactory(input.forkName)
    .fromSnapshot(input.snapshotName)
  return applyForkSettings(builder, input.settings)
}

function identityHash(identity: string): string {
  return createHash('sha256').update(identity).digest('hex').slice(0, 32)
}

function deriveSnapshotName(identity: string, optionsHash: string): string {
  const hash = createHash('sha256')
    .update(`${identity}:${optionsHash}`)
    .digest('hex')
    .slice(0, 32)
  return `${SNAPSHOT_PREFIX}-${hash}`
}

function deriveTemplateSandboxName(
  identity: string,
  optionsHash: string,
): string {
  const hash = createHash('sha256')
    .update(`${identity}:${optionsHash}`)
    .digest('hex')
    .slice(0, 32)
  return `${TEMPLATE_SANDBOX_PREFIX}-${hash}`
}

function isValidMetadata(value: unknown): value is TemplateMetadata {
  if (value == null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.version === METADATA_VERSION &&
    typeof v.identity === 'string' &&
    typeof v.snapshotName === 'string' &&
    typeof v.optionsHash === 'string' &&
    typeof v.createdAt === 'number'
  )
}
