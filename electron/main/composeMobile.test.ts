import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  type AdapterState,
  type Event,
  type MessageEvent,
  type Op,
  type SendRequest,
  type TaskRun,
  type ThreadId,
} from '@aiwc/protocol'
import { createGateway, type IlinkAdapter } from '@aiwc/gateway'
import type { SecretStore } from './config/secretStore'
import { composeMobile } from './composeMobile'
import type { AppContext } from './contracts'
import type { HostBridge } from './ipc/register'
import { registerMobileIpc } from './ipc/mobile'
import { createHandlerHarness } from './ipc/testing/handlerHarness'
import { MOBILE_SESSION_SECRET_REF, createSecretIlinkSessionStore } from './services/mobileStore'

const OWNER = 'owner_user_123456'

function memorySecrets(available = true): SecretStore {
  const map = new Map<string, string>()
  return {
    has: (ref) => map.has(ref),
    set: (ref, value) => {
      if (!available) throw new Error('no encryption')
      map.set(ref, value)
    },
    reveal: (ref) => map.get(ref) ?? null,
    delete: (ref) => void map.delete(ref),
    list: () => [...map.keys()],
    available: () => available,
  }
}

/** Scripted IlinkAdapter: logged in as OWNER, records sends, lets the test deliver messages. */
function fakeIlink(owner: string | null) {
  let state: AdapterState = 'disconnected'
  const messageHandlers = new Set<(e: MessageEvent) => void>()
  const stateHandlers = new Set<(s: AdapterState, d?: string) => void>()
  const sent: SendRequest[] = []
  let session = owner === null ? undefined : { token: 't', baseUrl: 'u', botId: 'b', userId: owner }
  const adapter: IlinkAdapter & { sent: SendRequest[]; deliver(e: MessageEvent): void } = {
    channel: 'wechat-ilink',
    capabilities: { typing: false, media: ['text'], splitsLongMessages: false, maxTextLength: 4000 },
    get state() {
      return state
    },
    get session() {
      return session
    },
    lastError: undefined,
    loginPhase: 'idle',
    async connect() {
      state = 'connected'
      for (const h of stateHandlers) h(state)
    },
    async disconnect() {
      state = 'disconnected'
    },
    async logout() {
      session = undefined
      state = 'needs_login'
      for (const h of stateHandlers) h(state)
    },
    cancelLogin() {},
    onMessage: (h) => {
      messageHandlers.add(h)
      return () => messageHandlers.delete(h)
    },
    onStateChange: (h) => {
      stateHandlers.add(h)
      return () => stateHandlers.delete(h)
    },
    onQr: () => () => {},
    async send(req) {
      sent.push(req)
      return { ok: true, messageId: `m${sent.length}` }
    },
    sent,
    deliver(e) {
      for (const h of messageHandlers) h(e)
    },
  }
  return adapter
}

function fakeKernel() {
  const ops: Op[] = []
  const listeners = new Set<(e: Event) => void>()
  return {
    ops,
    submit: vi.fn(async (op: Op) => {
      ops.push(op)
    }),
    events: { on: (l: (e: Event) => void) => (listeners.add(l), () => listeners.delete(l)) },
    getThread: vi.fn(async (_id: ThreadId) => undefined),
  }
}

function setup(opts: { owner?: string | null; secrets?: SecretStore } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aiwc-mobile-'))
  const gatewayStateDir = mkdtempSync(join(tmpdir(), 'aiwc-ilink-'))
  writeFileSync(join(gatewayStateDir, 'ilink-session.json'), '{"token":"plaintext"}')
  const gateway = createGateway({ rules: async () => [] })
  const adapter = fakeIlink(opts.owner === undefined ? OWNER : opts.owner)
  const kernel = fakeKernel()
  const broadcast = vi.fn()
  const mobile = composeMobile({
    dir,
    gatewayStateDir,
    gateway,
    kernel,
    secrets: opts.secrets ?? memorySecrets(),
    broadcast,
    logger: () => {},
    adapter,
  })
  const ipc = createHandlerHarness()
  registerMobileIpc({ mobile } as unknown as AppContext, {} as HostBridge, ipc.handle)
  const flush = () => new Promise((r) => setTimeout(r, 0))
  return { dir, gatewayStateDir, gateway, adapter, kernel, broadcast, mobile, ipc, flush }
}

const run = (over: Partial<TaskRun> = {}): TaskRun => ({
  id: 'run1',
  taskId: 'task1',
  trigger: 'schedule',
  status: 'done',
  startedAt: 1,
  denied: [],
  toolCalls: 0,
  summary: '今天有 3 条消息需要回复',
  ...over,
})

describe('composeMobile', () => {
  it('removes the plaintext login older builds left behind', () => {
    const s = setup()
    expect(existsSync(join(s.gatewayStateDir, 'ilink-session.json'))).toBe(false)
  })

  it('reports the bound owner masked, never the raw id', async () => {
    const s = setup()
    const status = await s.ipc.invoke('mobile:status', undefined)
    expect(status.owner).toBe('owne…3456')
    expect(JSON.stringify(status)).not.toContain(OWNER)
    expect(status.remote).toMatchObject({ enabled: false, permissionMode: 'ask', running: false, pendingApprovals: 0 })
    expect(status.persisted).toBe(true)
  })

  it('pushes a finished run only when the task asked for it, to the owner, and audits it', async () => {
    const s = setup()
    await s.mobile.pushTaskRun(run(), { id: 'task1', name: '晨报', pushToPhone: false })
    expect(s.adapter.sent).toEqual([])
    await s.mobile.pushTaskRun(run(), { id: 'task1', name: '晨报', pushToPhone: true })
    expect(s.adapter.sent).toHaveLength(1)
    const req = s.adapter.sent[0]!
    expect(req.to).toMatchObject({ channel: 'wechat-ilink', chatId: OWNER, peerId: OWNER })
    expect(req.parts[0]).toMatchObject({ type: 'text', text: expect.stringContaining('晨报') })
    expect(req.parts[0]).toMatchObject({ text: expect.stringContaining('今天有 3 条消息需要回复') })
    const sends = await s.ipc.invoke('mobile:sends', { limit: 5 })
    expect(sends[0]).toMatchObject({ kind: 'task', ok: true, taskId: 'task1' })
    // The audit log keeps sizes, never the text.
    expect(readFileSync(join(s.dir, 'sends.jsonl'), 'utf8')).not.toContain('晨报')
  })

  it('pushes failures and skips states that are not a result', async () => {
    const s = setup()
    const task = { id: 'task1', name: '晨报', pushToPhone: true }
    await s.mobile.pushTaskRun(run({ status: 'skipped' }), task)
    expect(s.adapter.sent).toEqual([])
    await s.mobile.pushTaskRun(run({ status: 'failed', error: 'model down', summary: undefined }), task)
    expect(s.adapter.sent[0]?.parts[0]).toMatchObject({ text: expect.stringContaining('model down') })
  })

  it('records a skipped push when no owner is bound', async () => {
    const s = setup({ owner: null })
    await s.mobile.pushTaskRun(run(), { id: 'task1', name: 'x', pushToPhone: true })
    expect(s.adapter.sent).toEqual([])
    const sends = await s.ipc.invoke('mobile:sends', undefined)
    expect(sends[0]).toMatchObject({ ok: false, error: expect.any(String) })
  })

  it('setRemote validates at runtime: Autopilot and unknown fields are refused', async () => {
    const s = setup()
    expect(() => s.ipc.invokeRaw('mobile:setRemote', { enabled: true, permissionMode: 'autopilot' })).toThrow()
    expect(() => s.ipc.invokeRaw('mobile:setRemote', { enabled: true, permissionMode: 'ask', extra: 1 })).toThrow()
    expect(() => s.ipc.invokeRaw('mobile:setRemote', null)).toThrow()
    const next = await s.ipc.invoke('mobile:setRemote', { enabled: true, permissionMode: 'bypass' })
    expect(next.remote).toMatchObject({ enabled: true, permissionMode: 'bypass' })
    expect(s.broadcast).toHaveBeenCalledWith('mobile:changed', expect.objectContaining({ remote: expect.anything() }))
    expect(JSON.parse(readFileSync(join(s.dir, 'state.json'), 'utf8'))).toMatchObject({
      remote: { enabled: true, permissionMode: 'bypass' },
    })
  })

  it('drives the phone thread only for the owner, once remote control is on', async () => {
    const s = setup()
    const msg = (peer: string, text: string): MessageEvent => ({
      id: `m_${text}`,
      source: { channel: 'wechat-ilink', peerId: peer, chatId: peer, chatType: 'dm' },
      kind: 'text',
      text,
      timestamp: 1,
      addressed: true,
    })
    s.adapter.deliver(msg('stranger', 'hi'))
    await s.flush()
    await s.flush()
    expect(s.kernel.ops).toEqual([])
    s.adapter.deliver(msg(OWNER, 'hi'))
    await s.flush()
    await s.flush()
    // Off by default: the owner is told once, nothing reaches the kernel.
    expect(s.kernel.ops).toEqual([])
    expect(s.adapter.sent).toHaveLength(1)

    await s.ipc.invoke('mobile:setRemote', { enabled: true, permissionMode: 'ask' })
    s.adapter.deliver(msg(OWNER, '帮我看看今天谁找我'))
    for (let i = 0; i < 5; i++) await s.flush()
    expect(s.kernel.ops.map((o) => o.type)).toEqual(['thread.create', 'turn.start'])
    expect(s.kernel.ops[0]).toMatchObject({
      origin: { channel: 'wechat-remote', chatId: OWNER },
      settings: { permissionMode: 'ask', profile: 'desktop-chat' },
    })
  })

  it('disconnect forgets the login', async () => {
    const s = setup()
    const status = await s.ipc.invoke('mobile:disconnect', undefined)
    expect(status.state).toBe('needs_login')
    expect(status.owner).toBeUndefined()
  })
})

describe('secret-backed iLink login', () => {
  it('round-trips the login through the encrypted store, never a file', () => {
    const secrets = memorySecrets()
    const store = createSecretIlinkSessionStore(secrets, () => {})
    store.save({ token: 'tok', baseUrl: 'https://x', botId: 'b', userId: OWNER })
    store.saveCursor('C1')
    const again = createSecretIlinkSessionStore(secrets, () => {})
    expect(again.load()).toMatchObject({ token: 'tok', userId: OWNER, getUpdatesBuf: 'C1' })
    again.clear()
    expect(secrets.has(MOBILE_SESSION_SECRET_REF)).toBe(false)
    expect(createSecretIlinkSessionStore(secrets, () => {}).load()).toBeUndefined()
  })

  it('keeps the login for this run only when encryption is unavailable', () => {
    const secrets = memorySecrets(false)
    const store = createSecretIlinkSessionStore(secrets, () => {})
    store.save({ token: 'tok', baseUrl: 'https://x', botId: 'b', userId: OWNER })
    expect(store.persisted).toBe(false)
    expect(store.load()).toMatchObject({ token: 'tok' })
    expect(secrets.list()).toEqual([])
  })

  it('ignores a stored value that is not a login', () => {
    const secrets = memorySecrets()
    secrets.set(MOBILE_SESSION_SECRET_REF, '{"token":""}')
    expect(createSecretIlinkSessionStore(secrets, () => {}).load()).toBeUndefined()
  })
})
