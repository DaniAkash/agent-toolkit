#!/usr/bin/env bun
/**
 * Fake ACP agent used by integration tests. Speaks JSON-RPC over stdio
 * and serves canned responses driven by environment variables:
 *
 *   FAKE_INITIALIZE_FIXTURE   path to a JSON file with the InitializeResponse body
 *   FAKE_NEWSESSION_FIXTURE   path to a JSON file with the NewSessionResponse body
 *   FAKE_SETCONFIG_BEHAVIOR   'ok' | 'method_not_found' | 'absent'
 *                             - 'ok'                — return success
 *                             - 'method_not_found'  — return ACP -32601
 *                             - 'absent'            — silently drop the request (hangs)
 *   FAKE_HANG_ON              'initialize' | 'session/new' | (unset)
 *                             - causes the script to read but never reply to that method
 *   FAKE_EXIT_BEFORE          'initialize' | 'session/new' | (unset)
 *                             - exit with code 1 before responding to the named method
 */
import { readFileSync } from 'node:fs'

const initFixture = process.env.FAKE_INITIALIZE_FIXTURE
const sessFixture = process.env.FAKE_NEWSESSION_FIXTURE
const setConfigBehavior = process.env.FAKE_SETCONFIG_BEHAVIOR ?? 'ok'
const hangOn = process.env.FAKE_HANG_ON ?? ''
const exitBefore = process.env.FAKE_EXIT_BEFORE ?? ''

if (!initFixture) {
  console.error('fake-agent: FAKE_INITIALIZE_FIXTURE is required')
  process.exit(2)
}
const initBody = JSON.parse(readFileSync(initFixture, 'utf8'))
const sessBody = sessFixture
  ? JSON.parse(readFileSync(sessFixture, 'utf8'))
  : null

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function reply(id: number | string, result: unknown): void {
  send({ jsonrpc: '2.0', id, result })
}

function replyError(id: number | string, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let nl = buffer.indexOf('\n')
  while (nl !== -1) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    nl = buffer.indexOf('\n')
    if (!line) continue
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    handle(msg)
  }
})

function handle(msg: Record<string, unknown>): void {
  const method = msg.method as string | undefined
  const id = msg.id as number | string | undefined
  if (method == null || id == null) return
  if (exitBefore === method) {
    process.exit(1)
  }
  if (hangOn === method) {
    // Read but never reply.
    return
  }
  switch (method) {
    case 'initialize':
      reply(id, initBody)
      return
    case 'session/new':
      if (sessBody) reply(id, sessBody)
      else replyError(id, -32601, 'session/new not implemented in fake agent')
      return
    case 'session/set_config_option':
      if (setConfigBehavior === 'method_not_found') {
        replyError(id, -32601, 'method not found')
      } else if (setConfigBehavior === 'absent') {
        // hang
      } else {
        reply(id, {})
      }
      return
    case 'session/close':
      reply(id, {})
      return
    default:
      replyError(id, -32601, `method ${method} not supported in fake agent`)
  }
}

process.stdin.on('end', () => {
  process.exit(0)
})
