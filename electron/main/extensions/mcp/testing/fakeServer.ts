/**
 * Test-only MCP server: a tiny stdio server as a `node -e` script (no file on disk to keep in sync), and the same
 * request handling. Tools: `echo` (read-only hint), `Delete-All` (destructive hint),
 * `slow` (never answers), `crash` (exits the process), `grow` (adds a tool and sends list_changed).
 */

/** Handles one JSON-RPC request; returns the response object, or undefined for notifications. */
const FAKE_HANDLER_SOURCE = String.raw`
let extra = false
const tools = () => [
  { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true } },
  { name: 'Delete-All', description: 'Delete everything', annotations: { destructiveHint: true } },
  { name: 'slow', description: 'Never returns' },
  { name: 'crash', description: 'Exits' },
  { name: 'grow', description: 'Adds a tool' },
  ...(extra ? [{ name: 'later', description: 'Added later' }] : []),
]
function handle(msg, send, exit) {
  if (msg.id === undefined) return
  const reply = (result) => send({ jsonrpc: '2.0', id: msg.id, result })
  switch (msg.method) {
    case 'initialize': return reply({ protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'fake', version: '9.9' } })
    case 'tools/list': return reply({ tools: tools() })
    case 'tools/call': {
      const { name, arguments: args } = msg.params
      if (name === 'echo') return reply({ content: [{ type: 'text', text: 'echo:' + (args.text ?? '') + ':' + (process.env.FAKE_TOKEN ?? '') }] })
      if (name === 'slow') return
      if (name === 'crash') return exit()
      if (name === 'grow') { extra = true; send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }); return reply({ content: [{ type: 'text', text: 'grown' }] }) }
      return reply({ content: [{ type: 'text', text: 'nope' }], isError: true })
    }
    default: return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'nope' } })
  }
}
`

export const FAKE_STDIO_SERVER = `${FAKE_HANDLER_SOURCE}
let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
    if (line.trim()) handle(JSON.parse(line), (m) => process.stdout.write(JSON.stringify(m) + '\\n'), () => { process.stderr.write('boom\\n'); process.exit(3) })
  }
})
`
