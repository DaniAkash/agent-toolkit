/**
 * Byte-preservation guards for the TOML emitter.
 *
 * Codex's `config.toml` is a file the user owns and hand-edits: model
 * choice, approval policy, sandbox permissions, feature flags. A
 * parse-then-serialise round trip drops every comment and blank line in
 * it and reorders the keys. These tests assert that adding and removing a
 * server changes exactly one span and leaves every other byte alone.
 */
import { describe, expect, test } from 'bun:test'
import { codex } from '../../src/_catalog/client-configs.ts'
import { getEmitter } from '../../src/emitters/index.ts'
import type { McpServerSpec } from '../../src/types.ts'

const io = getEmitter(codex, 'system')

const STDIO: McpServerSpec = {
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@upstash/context7-mcp'],
}

const HANDWRITTEN = `# My everyday model
model = "o3"
approval_policy = "on-request"

# Keep the sandbox tight in this project
[sandbox_workspace_write]
network_access = false
exclude_tmpdir_env_var = true
`

describe('comment and layout preservation', () => {
  test('adding a server leaves every pre-existing byte intact', () => {
    const out = io.add(HANDWRITTEN, 'context7', STDIO)

    // Every original line still present, in the original order.
    for (const line of HANDWRITTEN.split('\n').filter((l) => l.length > 0)) {
      expect(out).toContain(line)
    }
    expect(out.indexOf('# My everyday model')).toBeLessThan(
      out.indexOf('[sandbox_workspace_write]'),
    )
    expect(out).toContain('# Keep the sandbox tight in this project')
    // The original document is a literal prefix of the result: nothing
    // before the insertion point moved by a single byte.
    expect(out.startsWith(HANDWRITTEN)).toBe(true)
    expect(out).toContain('[mcp_servers.context7]')
    expect(out).toContain('command = "npx"')
    expect(out).toContain('args = ["-y", "@upstash/context7-mcp"]')
  })

  test('add then remove round-trips back to the original bytes', () => {
    const added = io.add(HANDWRITTEN, 'context7', STDIO)
    const removed = io.remove(added, 'context7')
    expect(removed).toBe(HANDWRITTEN)
  })

  test('replacing an existing server touches only its own table', () => {
    const first = io.add(HANDWRITTEN, 'context7', STDIO)
    const replaced = io.add(first, 'context7', {
      transport: 'stdio',
      command: 'bunx',
      args: ['other-server'],
    })
    expect(replaced).toContain('command = "bunx"')
    expect(replaced).not.toContain('@upstash/context7-mcp')
    // Still exactly one table for it, and the handwritten part untouched.
    expect(replaced.split('[mcp_servers.context7]')).toHaveLength(2)
    expect(replaced.startsWith(HANDWRITTEN)).toBe(true)
  })

  test('a comment between two server tables survives a removal', () => {
    let doc = io.add(HANDWRITTEN, 'alpha', STDIO)
    doc = io.add(doc, 'beta', STDIO)
    doc = doc.replace(
      '[mcp_servers.beta]',
      '# beta is the flaky one\n[mcp_servers.beta]',
    )
    const out = io.remove(doc, 'alpha')
    expect(out).toContain('# beta is the flaky one')
    expect(out).toContain('[mcp_servers.beta]')
    expect(out).not.toContain('[mcp_servers.alpha]')
    expect(out).toContain('# My everyday model')
  })

  test('a table header inside a multi-line string is not treated as one', () => {
    // The one way a naive line scan corrupts a real config.
    const withLiteral = `instructions = """
Use [mcp_servers.fake] to configure things.
[not.a.header]
"""

[mcp_servers.real]
command = "x"
`
    expect(io.read(withLiteral)).toEqual(['real'])
    const out = io.remove(withLiteral, 'real')
    expect(out).toContain('Use [mcp_servers.fake] to configure things.')
    expect(out).toContain('[not.a.header]')
    expect(out).not.toContain('[mcp_servers.real]')
  })

  test('http entries use the catalog field names', () => {
    const out = io.add('', 'remote', {
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer x' },
    })
    expect(out).toContain('[mcp_servers.remote]')
    expect(out).toContain('url = "https://mcp.example.com/mcp"')
    // Codex spells the header map `http_headers`, per the catalog.
    expect(out).toContain('http_headers = { Authorization = "Bearer x" }')
  })

  test('an empty file gains one table and nothing else', () => {
    const out = io.add('', 'solo', STDIO)
    expect(out).toBe(
      '[mcp_servers.solo]\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]\n',
    )
  })

  test('quotes and backslashes in values are escaped', () => {
    const out = io.add('', 'quoted', {
      transport: 'stdio',
      command: 'sh',
      args: ['-c', 'echo "hi" \\ there'],
    })
    expect(io.read(out)).toEqual(['quoted'])
    // Round-trips through a real parser rather than asserting on bytes.
    const reparsed = io.add(out, 'second', STDIO)
    expect(io.read(reparsed).sort()).toEqual(['quoted', 'second'])
  })
})
