// `/unstable` to match probe.ts: the stable entrypoint's types omit the
// capability fields this module reports. See the note in probe.ts.
import type {
  InitializeResponse,
  NewSessionResponse,
  SessionConfigOption as SdkConfigOption,
} from '@agentclientprotocol/sdk/unstable'
import type {
  AgentCapabilities,
  AgentInfo,
  AuthMethod,
  McpCapabilities,
  ModelConfigInfo,
  ProbedConfigOption,
  ProbedConfigOptionValue,
  ProbedMode,
  ProbedModel,
  PromptCapabilities,
  ReasoningInfo,
  SessionCapabilities,
} from '../types.ts'

export function normalizeAgentInfo(raw: InitializeResponse): AgentInfo | null {
  const info = raw.agentInfo
  if (!info) return null
  const name = typeof info.name === 'string' ? info.name : ''
  if (!name) return null
  return {
    name,
    ...(typeof info.title === 'string' ? { title: info.title } : {}),
    ...(typeof info.version === 'string' ? { version: info.version } : {}),
  }
}

export function normalizeCapabilities(
  raw: InitializeResponse,
): AgentCapabilities {
  const caps = raw.agentCapabilities ?? {}
  const promptCapabilities: PromptCapabilities = {
    image: Boolean(caps.promptCapabilities?.image),
    audio: Boolean(caps.promptCapabilities?.audio),
    embeddedContext: Boolean(caps.promptCapabilities?.embeddedContext),
  }
  const mcp = (caps.mcpCapabilities ?? {}) as Record<string, unknown>
  // `acp` joins http/sse as a named transport rather than landing in the
  // `meta` catch-all. Destructured out for that reason; anything still
  // unrecognised keeps falling through to `meta`.
  const { http, sse, acp, _meta: _ignoredMeta, ...rest } = mcp
  const restEntries = Object.entries(rest)
  const mcpCapabilities: McpCapabilities = {
    http: Boolean(http),
    sse: Boolean(sse),
    acp: Boolean(acp),
    ...(restEntries.length > 0
      ? { meta: Object.fromEntries(restEntries) }
      : {}),
  }
  const sess = (caps.sessionCapabilities ?? {}) as Record<string, unknown>
  const sessionCapabilities: SessionCapabilities = {
    close: advertised(sess.close),
    list: advertised(sess.list),
    resume: advertised(sess.resume),
    fork: advertised(sess.fork),
    systemPrompt: advertised(sess.systemPrompt),
    additionalDirectories: advertised(sess.additionalDirectories),
  }
  // Everything the four named capability groups above did not consume.
  // An allowlist here would silently drop a capability an agent advertises,
  // which is the one thing a capability probe must not do: ACP adds
  // top-level capabilities faster than this package can name them.
  const KNOWN_CAPABILITY_KEYS = new Set([
    'loadSession',
    'promptCapabilities',
    'mcpCapabilities',
    'sessionCapabilities',
    '_meta',
  ])
  const experimental: AgentCapabilities['experimental'] = {}
  for (const [key, value] of Object.entries(caps as Record<string, unknown>)) {
    if (KNOWN_CAPABILITY_KEYS.has(key)) continue
    if (value == null) continue
    experimental[key] = value
  }
  return {
    loadSession: Boolean(caps.loadSession),
    promptCapabilities,
    mcpCapabilities,
    sessionCapabilities,
    ...(Object.keys(experimental).length > 0 ? { experimental } : {}),
  }
}

/**
 * Whether a session sub-capability counts as advertised.
 *
 * ACP spells these as an object: `{}` means supported, omitted or `null`
 * means not. So presence is the signal and `Boolean(value)` would agree,
 * since `{}` is truthy. The two diverge only on an off-spec literal
 * `false`, which pre-object agents did send and which a bare presence
 * check would read as supported. Rejecting `false` explicitly covers both
 * spellings.
 */
function advertised(value: unknown): boolean {
  return value != null && value !== false
}

export function normalizeAuthMethods(raw: InitializeResponse): AuthMethod[] {
  const methods = raw.authMethods ?? []
  return methods.map((m) => {
    const record = m as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : ''
    const name = typeof record.name === 'string' ? record.name : id
    const description =
      typeof record.description === 'string' ? record.description : undefined
    const type = typeof record.type === 'string' ? record.type : undefined
    const vars = Array.isArray(record.vars)
      ? (record.vars as Array<{ name: unknown }>)
          .map((v) => (typeof v.name === 'string' ? { name: v.name } : null))
          .filter((v): v is { name: string } => v !== null)
      : undefined
    const meta = (record._meta ?? null) as Record<string, unknown> | null
    return {
      id,
      name,
      ...(description !== undefined ? { description } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(vars !== undefined ? { vars } : {}),
      ...(meta !== null && typeof meta === 'object' ? { meta } : {}),
    }
  })
}

/**
 * The models the agent's settable picker exposes. ACP 1.x removed the
 * separate declarative `session/new.models.availableModels` list, so the
 * model-selector config option is now the single source; its option ids
 * are exactly the values `setConfigOption` accepts.
 */
export function normalizeModels(
  configOptions: ProbedConfigOption[],
): ProbedModel[] {
  const opt = findModelOption(configOptions)
  if (!opt?.options) return []
  return opt.options.map((v) => ({
    id: v.value,
    ...(v.name !== undefined ? { name: v.name } : {}),
    ...(v.description !== undefined ? { description: v.description } : {}),
  }))
}

export function normalizeModes(raw: NewSessionResponse | null): ProbedMode[] {
  if (!raw?.modes) return []
  return raw.modes.availableModes.map((m) => ({
    id: m.id,
    ...(typeof m.name === 'string' ? { name: m.name } : {}),
    ...(typeof m.description === 'string'
      ? { description: m.description }
      : {}),
  }))
}

export function normalizeConfigOptions(
  raw: NewSessionResponse | null,
): ProbedConfigOption[] {
  const options = raw?.configOptions
  if (!options) return []
  return options.map(normalizeConfigOption)
}

function normalizeConfigOption(o: SdkConfigOption): ProbedConfigOption {
  const id = o.id
  const name = o.name
  const description =
    typeof o.description === 'string' ? o.description : undefined
  const category = typeof o.category === 'string' ? o.category : undefined
  if (o.type === 'select') {
    const values: ProbedConfigOptionValue[] = collectSelectValues(o.options)
    return {
      id,
      name,
      ...(description !== undefined ? { description } : {}),
      ...(category !== undefined ? { category } : {}),
      type: 'select',
      currentValue: o.currentValue,
      options: values,
    }
  }
  // boolean
  return {
    id,
    name,
    ...(description !== undefined ? { description } : {}),
    ...(category !== undefined ? { category } : {}),
    type: 'boolean',
    currentValue: o.currentValue,
  }
}

function collectSelectValues(options: unknown): ProbedConfigOptionValue[] {
  if (!Array.isArray(options)) return []
  const out: ProbedConfigOptionValue[] = []
  for (const entry of options) {
    if (!entry || typeof entry !== 'object') continue
    const rec = entry as Record<string, unknown>
    // SessionConfigSelectOption: { value, name, description? }
    if (typeof rec.value === 'string') {
      out.push({
        value: rec.value,
        ...(typeof rec.name === 'string' ? { name: rec.name } : {}),
        ...(typeof rec.description === 'string'
          ? { description: rec.description }
          : {}),
      })
      continue
    }
    // SessionConfigSelectGroup: { groupId, options: [...] } — flatten.
    if (Array.isArray(rec.options)) {
      out.push(...collectSelectValues(rec.options))
    }
  }
  return out
}

export function deriveReasoning(
  configOptions: ProbedConfigOption[],
): ReasoningInfo | null {
  const opt = configOptions.find(
    (o) => o.category === 'thought_level' && o.type === 'select',
  )
  if (!opt?.options) return null
  return {
    configId: opt.id,
    values: opt.options.map((v) => v.value),
    ...(typeof opt.currentValue === 'string'
      ? { defaultValue: opt.currentValue }
      : {}),
  }
}

/**
 * Find the settable model-selector config option. Agents identify it by
 * `id === 'model'` or by category (`'model'`, or ACP 1.x's `'model_config'`).
 */
function findModelOption(
  configOptions: ProbedConfigOption[],
): ProbedConfigOption | undefined {
  return configOptions.find(
    (o) =>
      o.type === 'select' &&
      (o.id === 'model' ||
        o.category === 'model' ||
        o.category === 'model_config'),
  )
}

export function deriveModelConfig(
  configOptions: ProbedConfigOption[],
): ModelConfigInfo | null {
  const opt = findModelOption(configOptions)
  if (!opt?.options) return null
  return {
    configId: opt.id,
    values: opt.options.map((v) => v.value),
    ...(typeof opt.currentValue === 'string'
      ? { currentValue: opt.currentValue }
      : {}),
  }
}
