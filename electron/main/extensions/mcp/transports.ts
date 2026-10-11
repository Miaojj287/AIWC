/**
 * MCP transports: stdio (a local command, newline-delimited JSON on stdin / stdout), Streamable HTTP (POST per
 * message, JSON or SSE responses, `Mcp-Session-Id`), and the legacy HTTP + SSE pair (GET event stream announcing a
 * POST endpoint). Each is bounded: a stderr tail instead of the whole stream, a header timeout on every request, and a
 * close that kills the server's whole process group.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { asJsonRpcMessage, McpError, type JsonRpcMessage, type McpTransport } from './jsonRpc'

const STDERR_TAIL_CHARS = 2_000
const KILL_GRACE_MS = 2_000
/** Time allowed for an HTTP response's headers (the body may stream for longer). */
export const HTTP_HEADER_TIMEOUT_MS = 30_000
const ENDPOINT_WAIT_MS = 15_000
const DELETE_TIMEOUT_MS = 3_000
const MAX_LINE_CHARS = 8_000_000

function deliver(transport: McpTransport, raw: string, onBad?: (raw: string) => void): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    onBad?.(raw)
    return
  }
  for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
    const message = asJsonRpcMessage(item)
    if (message) transport.onmessage?.(message)
    else onBad?.(raw)
  }
}

// ------------------------------------------------------------------------------------------------ stdio

export interface StdioTransportOptions {
  command: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
  cwd?: string
  onDebug?: (message: string, meta?: unknown) => void
}

export interface StdioTransport extends McpTransport {
  /** The last bit of the server's stderr, for the error shown in settings. */
  stderrTail(): string
}

export function createStdioTransport(opts: StdioTransportOptions): StdioTransport {
  let child: ChildProcess | undefined
  let stderr = ''
  let buffer = ''
  let closing = false

  const kill = (signal: NodeJS.Signals): void => {
    if (!child?.pid) return
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on(
          'error',
          () => undefined,
        )
      } else process.kill(-child.pid, signal)
    } catch {
      // ESRCH: the group is already gone.
    }
  }

  const transport: StdioTransport = {
    stderrTail: () => stderr.trim(),
    start() {
      return new Promise<void>((resolve, reject) => {
        let started = false
        try {
          child = spawn(opts.command, [...opts.args], {
            env: opts.env,
            cwd: opts.cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            // Own process group on POSIX so close() reaches whatever the server forks (npx → node → server).
            detached: process.platform !== 'win32',
            windowsHide: true,
          })
        } catch (err) {
          reject(new McpError('spawn_failed', err instanceof Error ? err.message : String(err), { cause: err }))
          return
        }
        child.once('spawn', () => {
          started = true
          resolve()
        })
        child.once('error', (err) => {
          if (!started) reject(new McpError('spawn_failed', err.message, { cause: err }))
          else transport.onclose?.(new McpError('exited', err.message, { cause: err }))
        })
        child.once('exit', (code, signal) => {
          if (closing) {
            transport.onclose?.()
            return
          }
          const detail = transport.stderrTail() || `exit ${code ?? signal ?? '?'}`
          transport.onclose?.(new McpError('exited', detail))
        })
        child.stdout?.setEncoding('utf8')
        child.stdout?.on('data', (chunk: string) => {
          buffer += chunk
          if (buffer.length > MAX_LINE_CHARS) {
            opts.onDebug?.('mcp stdout line too long; dropped')
            buffer = ''
            return
          }
          let nl = buffer.indexOf('\n')
          while (nl >= 0) {
            const line = buffer.slice(0, nl).trim()
            buffer = buffer.slice(nl + 1)
            if (line) deliver(transport, line, () => opts.onDebug?.('non-JSON line on mcp stdout'))
            nl = buffer.indexOf('\n')
          }
        })
        child.stderr?.setEncoding('utf8')
        child.stderr?.on('data', (chunk: string) => {
          stderr = (stderr + chunk).slice(-STDERR_TAIL_CHARS)
        })
        child.stdin?.on('error', () => {
          // The server may exit before reading; the exit handler reports it.
        })
      })
    },
    send(message: JsonRpcMessage) {
      return new Promise<void>((resolve, reject) => {
        const stdin = child?.stdin
        if (!stdin || stdin.destroyed) {
          reject(new McpError('exited', 'server is not running'))
          return
        }
        stdin.write(`${JSON.stringify(message)}\n`, (err) =>
          err ? reject(new McpError('exited', err.message)) : resolve(),
        )
      })
    },
    async close() {
      if (!child || closing) return
      closing = true
      const proc = child
      if (proc.exitCode !== null || proc.signalCode !== null) return
      proc.stdin?.end()
      kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          kill('SIGKILL')
          resolve()
        }, KILL_GRACE_MS)
        proc.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
  }
  return transport
}

// ------------------------------------------------------------------------------------------------ SSE parsing

export interface SseEvent {
  event: string
  data: string
}

/** Reads a text/event-stream body and calls `onEvent` per event until the stream ends or is aborted. */
export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (event: SseEvent) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = 'message'
  let data: string[] = []
  const flush = (): void => {
    if (data.length) onEvent({ event, data: data.join('\n') })
    event = 'message'
    data = []
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl = buffer.search(/\r?\n/)
      while (nl >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(buffer[nl] === '\r' ? nl + 2 : nl + 1)
        if (line === '') flush()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
        else if (line.startsWith('event:')) event = line.slice(6).trim()
        nl = buffer.search(/\r?\n/)
      }
    }
    flush()
  } finally {
    reader.releaseLock()
  }
}

// ------------------------------------------------------------------------------------------------ HTTP

export interface HttpTransportOptions {
  url: string
  headers: Record<string, string>
  fetch?: typeof fetch
  onDebug?: (message: string, meta?: unknown) => void
}

export interface HttpTransport extends McpTransport {
  /** Sent as `MCP-Protocol-Version` once initialize has agreed on one. */
  setProtocolVersion(version: string): void
}

async function postWithHeaderTimeout(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  closeSignal: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  const onClose = (): void => controller.abort()
  closeSignal.addEventListener('abort', onClose, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('timeout')), HTTP_HEADER_TIMEOUT_MS)
  try {
    return await doFetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    throw new McpError('http', err instanceof Error ? err.message : String(err), { cause: err })
  } finally {
    clearTimeout(timer)
    closeSignal.removeEventListener('abort', onClose)
  }
}

/** Streamable HTTP (MCP 2025-03-26+). */
export function createHttpTransport(opts: HttpTransportOptions): HttpTransport {
  const doFetch = opts.fetch ?? fetch
  const closer = new AbortController()
  let sessionId: string | undefined
  let protocolVersion: string | undefined

  const headers = (): Record<string, string> => ({
    ...opts.headers,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    ...(protocolVersion ? { 'mcp-protocol-version': protocolVersion } : {}),
  })

  const transport: HttpTransport = {
    setProtocolVersion(version) {
      protocolVersion = version
    },
    async start() {
      // Nothing to open: every message is its own POST.
    },
    async send(message) {
      const res = await postWithHeaderTimeout(
        doFetch,
        opts.url,
        { method: 'POST', headers: headers(), body: JSON.stringify(message) },
        closer.signal,
      )
      const sid = res.headers.get('mcp-session-id')
      if (sid) sessionId = sid
      if (res.status === 202 || res.status === 204) return
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new McpError('http', `HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`)
      }
      const type = res.headers.get('content-type') ?? ''
      if (type.includes('text/event-stream') && res.body) {
        // The response(s) arrive on this stream; keep reading in the background so send() returns promptly.
        void readSse(res.body, (e) => {
          if (e.event === 'message') deliver(transport, e.data, () => opts.onDebug?.('non-JSON SSE data'))
        }).catch((err: unknown) => opts.onDebug?.('mcp sse stream ended', err))
        return
      }
      const text = await res.text()
      if (text.trim()) deliver(transport, text, () => opts.onDebug?.('non-JSON HTTP body'))
    },
    async close() {
      closer.abort()
      if (!sessionId) return
      try {
        await doFetch(opts.url, {
          method: 'DELETE',
          headers: { ...opts.headers, 'mcp-session-id': sessionId },
          signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
        })
      } catch (err) {
        // Best effort: the session expires on the server anyway.
        opts.onDebug?.('mcp session delete failed', err)
      }
    },
  }
  return transport
}

/** Legacy HTTP + SSE (MCP 2024-11-05): a GET event stream announces where to POST. */
export function createSseTransport(opts: HttpTransportOptions): HttpTransport {
  const doFetch = opts.fetch ?? fetch
  const closer = new AbortController()
  let endpoint: string | undefined
  let protocolVersion: string | undefined
  let closed = false

  const transport: HttpTransport = {
    setProtocolVersion(version) {
      protocolVersion = version
    },
    async start() {
      let res: Response
      try {
        res = await doFetch(opts.url, {
          method: 'GET',
          headers: { ...opts.headers, accept: 'text/event-stream' },
          signal: closer.signal,
        })
      } catch (err) {
        throw new McpError('http', err instanceof Error ? err.message : String(err), { cause: err })
      }
      if (!res.ok || !res.body) throw new McpError('http', `HTTP ${res.status}`)
      const announced = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new McpError('timeout', 'no endpoint event')), ENDPOINT_WAIT_MS)
        void readSse(res.body!, (e) => {
          if (e.event === 'endpoint') {
            clearTimeout(timer)
            resolve(e.data.trim())
          } else if (e.event === 'message') deliver(transport, e.data, () => opts.onDebug?.('non-JSON SSE data'))
        })
          .catch((err: unknown) => opts.onDebug?.('mcp sse stream failed', err))
          .finally(() => {
            clearTimeout(timer)
            reject(new McpError('exited', 'event stream closed'))
            if (!closed) transport.onclose?.(new McpError('exited', 'event stream closed'))
          })
      })
      const target = new URL(await announced, opts.url)
      // The headers carry the user's token: never POST them to another origin than the one configured.
      if (target.origin !== new URL(opts.url).origin) throw new McpError('protocol', 'endpoint on another origin')
      endpoint = target.toString()
    },
    async send(message) {
      if (!endpoint) throw new McpError('exited', 'not connected')
      const res = await postWithHeaderTimeout(
        doFetch,
        endpoint,
        {
          method: 'POST',
          headers: {
            ...opts.headers,
            'content-type': 'application/json',
            ...(protocolVersion ? { 'mcp-protocol-version': protocolVersion } : {}),
          },
          body: JSON.stringify(message),
        },
        closer.signal,
      )
      if (!res.ok) throw new McpError('http', `HTTP ${res.status}`)
      await res.body?.cancel().catch(() => undefined) // responses arrive on the event stream
    },
    async close() {
      closed = true
      closer.abort()
    },
  }
  return transport
}
