/**
 * Argument validation for an incoming `tools/call`.
 *
 * Load-bearing rather than defensive: a probe against codex-acp answered a
 * `tools/list` that declared `answer: { type: 'string' }` with
 * `{"answer": 42}`. The agent does not coerce to the advertised type, so a
 * host writing `inputSchema: { answer: { type: 'string' } }` would receive
 * a number unless something checks. It gets an MCP error instead.
 *
 * Deliberately a subset of JSON Schema: the keywords a tool signature
 * actually uses. Anything unrecognised is ignored rather than guessed at,
 * so an unsupported keyword never rejects a legitimate call.
 */
import type { AcpxHostToolSchema } from './types.ts'

export interface ValidationIssue {
  path: string
  message: string
}

const TYPE_NAMES = [
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'null',
] as const

type TypeName = (typeof TYPE_NAMES)[number]

function typeOf(value: unknown): TypeName | 'unknown' {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  switch (typeof value) {
    case 'string':
      return 'string'
    case 'boolean':
      return 'boolean'
    case 'number':
      return Number.isInteger(value) ? 'integer' : 'number'
    case 'object':
      return 'object'
    default:
      return 'unknown'
  }
}

function matchesType(value: unknown, expected: string): boolean {
  const actual = typeOf(value)
  if (expected === 'number') return actual === 'number' || actual === 'integer'
  if (expected === 'integer') return actual === 'integer'
  return actual === expected
}

function describe(value: unknown): string {
  const t = typeOf(value)
  return t === 'unknown' ? typeof value : t
}

/**
 * Checks `type` / `enum` only. Split out so the recursive walk stays flat:
 * a wrong type makes every nested check a consequence of the same fault,
 * so the caller stops instead of emitting a cascade.
 */
function checkScalar(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): 'ok' | 'type-mismatch' {
  const expected = schema.type
  if (typeof expected === 'string' && !matchesType(value, expected)) {
    issues.push({
      path,
      message: `expected ${expected}, received ${describe(value)}`,
    })
    return 'type-mismatch'
  }
  if (Array.isArray(expected)) {
    const ok = expected.some(
      (t) => typeof t === 'string' && matchesType(value, t),
    )
    if (!ok) {
      issues.push({
        path,
        message: `expected one of ${expected.join(', ')}, received ${describe(value)}`,
      })
      return 'type-mismatch'
    }
  }
  const enumValues = schema.enum
  if (Array.isArray(enumValues) && !enumValues.includes(value as never)) {
    issues.push({
      path,
      message: `must be one of ${enumValues.map((v) => JSON.stringify(v)).join(', ')}`,
    })
  }
  return 'ok'
}

function validateValue(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  if (checkScalar(value, schema, path, issues) === 'type-mismatch') return

  if (typeOf(value) === 'object') {
    validateObject(value as Record<string, unknown>, schema, path, issues)
    return
  }
  if (Array.isArray(value) && isSchema(schema.items)) {
    for (const [i, item] of value.entries()) {
      validateValue(item, schema.items, `${path}[${i}]`, issues)
    }
  }
}

function isSchema(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function checkRequired(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  const required = Array.isArray(schema.required) ? schema.required : []
  for (const key of required) {
    if (typeof key !== 'string') continue
    // `Object.hasOwn`, not `in`: `in` walks the prototype chain, so a
    // schema requiring `toString` (or `constructor`, `valueOf`, ...) saw
    // `{}` as satisfying it and `execute` then received no own argument.
    if (Object.hasOwn(value, key) && value[key] !== undefined) continue
    issues.push({ path: join(path, key), message: 'is required' })
  }
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key
}

function validateObject(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  checkRequired(value, schema, path, issues)
  const properties = isSchema(schema.properties) ? schema.properties : {}
  const rejectsUnknown = schema.additionalProperties === false

  for (const [key, raw] of Object.entries(value)) {
    const sub = properties[key]
    if (isSchema(sub)) {
      validateValue(raw, sub, join(path, key), issues)
    } else if (rejectsUnknown) {
      issues.push({
        path: join(path, key),
        message: 'is not a known property',
      })
    }
  }
}

/**
 * Returns the issues found, empty when the input satisfies the schema.
 * Never throws: a malformed schema yields no issues rather than failing a
 * call the host might have been happy to serve.
 */
export function validateToolInput(
  input: unknown,
  schema: AcpxHostToolSchema,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (typeOf(input) !== 'object') {
    return [
      { path: '', message: `expected object, received ${describe(input)}` },
    ]
  }
  try {
    validateObject(
      input as Record<string, unknown>,
      schema as unknown as Record<string, unknown>,
      '',
      issues,
    )
  } catch {
    return []
  }
  return issues
}

export function formatIssues(issues: ValidationIssue[]): string {
  return issues
    .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
    .join('; ')
}
