import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MessageEvent } from '@aiwc/protocol'
import { createIlinkAdapter, type IlinkAdapter } from './adapter'
import { buildSendMessageBody, createIlinkClient } from './client'
import { encryptAesEcb } from './media'
import updates from './fixtures/updates.json'
import qr from './fixtures/qr.json'

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown; signal?: AbortSignal }

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

/** Scripted fetch: route by URL substring; long polls hang until aborted. */
function createFakeFetch(routes: Record<string, (call: Call, n: number) => Response | Promise<Response>>) {
  const calls: Call[] = []
  const counts = new Map<string, number>()
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}))
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
    const call: Call = { url: input, method: init?.method ?? 'GET', headers, body, signal: init?.signal ?? undefined }
    calls.push(call)
    const key = Object.keys(routes).find((k) => input.includes(k))
    if (!key) return new Response('not found', { status: 404 })
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    const signal = init?.signal
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    const handler = routes[key]!
    return handler(call, n)
  }
  return { fetchImpl, calls, of: (fragment: string) => calls.filter((c) => c.url.includes(fragment)) }
}

const hang = (signal?: AbortSignal | null): Promise<Response> =>
  new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
  })

const waitFor = async (pred: () => boolean, ms = 2000): Promise<void> => {
  const end = Date.now() + ms
  while (!pred()) {
    if (Date.now() > end) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('iLink client', () => {
  it('pins the sendmessage body shape including context_token and auth headers', async () => {
    const fake = createFakeFetch({ 'ilink/bot/sendmessage': () => jsonResponse({ ret: 0 }) })
    const client = createIlinkClient({ fetch: fake.fetchImpl, random: { bytes: (n) => Buffer.alloc(n, 1), uuid: () => 'uuid-1' } })
    const session = { token: 'tok', baseUrl: 'https://api.test', botId: 'b', userId: 'u' }
    const res = await client.sendText(session, 'peer_1', '你好', 'ctx-77')
    expect(res.clientId).toBe('aiwc-uuid-1')
    const call = fake.of('sendmessage')[0]!
    expect(call.url).toBe('https://api.test/ilink/bot/sendmessage')
    expect(call.method).toBe('POST')
    expect(call.headers.Authorization).toBe('Bearer tok')
    expect(call.headers.AuthorizationType).toBe('ilink_bot_token')
    expect(call.headers['iLink-App-Id']).toBe('bot')
    expect(call.headers['X-WECHAT-UIN']).toBe(Buffer.from(String(0x01010101)).toString('base64'))
    expect(call.body).toEqual({
      ...buildSendMessageBody('peer_1', [{ type: 1, text_item: { text: '你好' } }], 'aiwc-uuid-1', 'ctx-77'),
      base_info: { channel_version: '2.4.4', bot_agent: 'OpenClaw' },
    })
  })

  it('surfaces non-zero ret as an error and HTTP failures as thrown errors', async () => {
    const fake = createFakeFetch({
      'ilink/bot/sendmessage': (_c, n) => (n === 1 ? jsonResponse({ ret: -14, errmsg: 'session timeout' }) : new Response('boom', { status: 500 })),
    })
    const client = createIlinkClient({ fetch: fake.fetchImpl })
    const session = { token: 'tok', baseUrl: 'https://api.test', botId: 'b', userId: 'u' }
    await expect(client.sendText(session, 'p', 'x')).rejects.toThrow(/-14/)
    await expect(client.sendText(session, 'p', 'x')).rejects.toThrow(/HTTP 500/)
  })

  it('returns an empty update (same cursor) when the long poll is aborted', async () => {
    const fake = createFakeFetch({ 'ilink/bot/getupdates': (c) => hang(c.signal) })
    const client = createIlinkClient({ fetch: fake.fetchImpl })
    const abort = new AbortController()
    const p = client.getUpdates({ token: 't', baseUrl: 'https://api.test', botId: '', userId: '' }, 'CUR', abort.signal)
    abort.abort()
    expect(await p).toEqual({ ret: 0, msgs: [], get_updates_buf: 'CUR' })
  })

  it('uploads media: getuploadurl body + encrypted CDN post + item shape', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ilink-up-'))
    const file = join(dir, 'pic.jpg')
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('payload')])
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, jpeg)
    try {
      const fake = createFakeFetch({
        'ilink/bot/getuploadurl': () => jsonResponse({ upload_param: 'UP', ret: 0 }),
        '/upload?': () => new Response('', { status: 200, headers: { 'x-encrypted-param': 'DL-PARAM' } }),
        'ilink/bot/sendmessage': () => jsonResponse({ ret: 0 }),
      })
      const key = Buffer.alloc(16, 7)
      const client = createIlinkClient({ fetch: fake.fetchImpl, random: { bytes: (n) => Buffer.alloc(n, 7), uuid: () => 'u2' } })
      const session = { token: 'tok', baseUrl: 'https://api.test', botId: 'b', userId: 'u' }
      await client.sendImage(session, 'peer', file, 'ctx')
      const up = fake.of('getuploadurl')[0]!.body as Record<string, unknown>
      expect(up).toMatchObject({ media_type: 1, to_user_id: 'peer', rawsize: jpeg.length, filesize: 16, no_need_thumb: true, aeskey: key.toString('hex') })
      expect(up.filekey).toBe(`${key.toString('hex')}.jpg`)
      const cdn = fake.of('/upload?')[0]!
      expect(cdn.url).toBe(`https://api.test/upload?encrypted_query_param=UP&filekey=${key.toString('hex')}.jpg`)
      expect(Buffer.from(cdn.body as Uint8Array).equals(encryptAesEcb(jpeg, key))).toBe(true)
      const sent = fake.of('sendmessage')[0]!.body as { msg: { item_list: unknown[]; context_token: string } }
      expect(sent.msg.context_token).toBe('ctx')
      expect(sent.msg.item_list[0]).toEqual({ type: 2, image_item: { media: { encrypt_query_param: 'DL-PARAM', aes_key: Buffer.from(key.toString('hex')).toString('base64'), encrypt_type: 1 }, mid_size: 16 } })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('iLink adapter', () => {
  let stateDir: string
  let adapter: IlinkAdapter | undefined
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'ilink-state-'))
  })
  afterEach(async () => {
    await adapter?.disconnect().catch(() => {})
    adapter = undefined
    rmSync(stateDir, { recursive: true, force: true })
  })

  function makeAdapter(fake: ReturnType<typeof createFakeFetch>, extra: Partial<Parameters<typeof createIlinkAdapter>[0]> = {}) {
    const qrs: string[] = []
    const states: Array<{ state: string; detail?: string }> = []
    const received: MessageEvent[] = []
    adapter = createIlinkAdapter({
      stateDir,
      fetch: fake.fetchImpl,
      renderQr: async (content) => `data:qr,${content}`,
      onQr: (u) => qrs.push(u),
      sleep: async () => {},
      bubblePauseMs: [0, 0],
      ...extra,
    })
    adapter.onStateChange((state, detail) => states.push({ state, detail }))
    adapter.onMessage((e) => received.push(e))
    return { adapter, qrs, states, received }
  }

  it('starts in needs_login without a stored session, polls the QR until confirmed, persists the session and starts receiving', async () => {
    const fake = createFakeFetch({
      get_bot_qrcode: () => jsonResponse(qr.qrcode),
      get_qrcode_status: (_c, n) => jsonResponse(n === 1 ? qr.status_wait : n === 2 ? qr.status_scaned : qr.status_confirmed),
      notifystart: () => jsonResponse({ ret: 0 }),
      notifystop: () => jsonResponse({ ret: 0 }),
      'ilink/bot/getupdates': (c) => hang(c.signal),
    })
    const { adapter: a, qrs, states, received } = makeAdapter(fake)
    expect(a.state).toBe('needs_login')

    await a.connect()
    expect(qrs).toEqual([`data:qr,${qr.qrcode.qrcode_img_content}`])
    expect(states.map((s) => s.state)).toEqual(['connecting', 'connecting', 'connected'])
    expect(states[1]?.detail).toContain('已扫码')
    expect(a.session).toEqual({ token: 'bot-token-xyz', baseUrl: 'https://ilinkai.weixin.qq.com', botId: 'bot_1', userId: 'owner_user_1' })
    const stored = JSON.parse(readFileSync(join(stateDir, 'ilink-session.json'), 'utf8'))
    expect(stored).toMatchObject({ token: 'bot-token-xyz', botId: 'bot_1', userId: 'owner_user_1' })
    expect(fake.of('get_qrcode_status')[0]!.url).toContain('qrcode=qr-token-1')

    await waitFor(() => fake.of('notifystart').length === 1 && fake.of('getupdates').length === 1)
    expect(fake.of('getupdates')[0]!.body).toMatchObject({ get_updates_buf: '' })
    expect(received).toEqual([])

    await a.disconnect()
    expect(a.state).toBe('disconnected')
    expect(fake.of('notifystop')).toHaveLength(1)
    // connecting again with a stored session skips the QR flow
    await a.connect()
    expect(fake.of('get_bot_qrcode')).toHaveLength(1)
    expect(a.state).toBe('connected')
  })

  it('refreshes an expired QR and fails after too many expiries', async () => {
    const fake = createFakeFetch({
      get_bot_qrcode: (_c, n) => jsonResponse({ ...qr.qrcode, qrcode: `qr-${n}` }),
      get_qrcode_status: () => jsonResponse(qr.status_expired),
    })
    const { adapter: a, qrs } = makeAdapter(fake)
    await expect(a.connect()).rejects.toThrow(/二维码多次过期/)
    expect(qrs).toHaveLength(4)
    expect(a.state).toBe('error')
    expect(a.lastError).toContain('二维码')
  })

  it('cancelLogin aborts QR polling and returns to needs_login', async () => {
    const fake = createFakeFetch({
      get_bot_qrcode: () => jsonResponse(qr.qrcode),
      get_qrcode_status: () => jsonResponse(qr.status_wait),
    })
    let ticks = 0
    const { adapter: a } = makeAdapter(fake, {
      sleep: async () => {
        if (++ticks === 3) a.cancelLogin()
      },
    })
    await a.connect()
    expect(a.state).toBe('needs_login')
    expect(a.session).toBeUndefined()
  })

  it('normalises updates into MessageEvents, dedupes redeliveries, skips bot echoes and persists the cursor', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('imgdata')])
    const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
    const fake = createFakeFetch({
      notifystart: () => jsonResponse({ ret: 0 }),
      notifystop: () => jsonResponse({ ret: 0 }),
      'cdn.example/img1': () => new Response(new Uint8Array(encryptAesEcb(jpeg, key)), { status: 200 }),
      'cdn.example/voice1': () => new Response(new Uint8Array(encryptAesEcb(Buffer.from('#!SILK_V3voice'), key)), { status: 200 }),
      'cdn.example/file1': () => new Response('not found', { status: 404 }),
      // first two polls redeliver the same batch; afterwards hang until abort
      'ilink/bot/getupdates': (c, n) => (n <= 2 ? jsonResponse(updates) : hang(c.signal)),
    })
    const polls = () => fake.of('getupdates').length
    // pre-seed a session so connect() skips the QR flow
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(stateDir, 'ilink-session.json'), JSON.stringify({ token: 't', baseUrl: 'https://api.test', botId: 'b', userId: 'u', savedAt: 'x', getUpdatesBuf: 'CURSOR_1' }))

    const { adapter: a, received } = makeAdapter(fake)
    expect(a.state).toBe('disconnected')
    await a.connect()
    await waitFor(() => polls() >= 3)
    await waitFor(() => received.length === 4)

    expect(fake.of('getupdates')[0]!.body).toMatchObject({ get_updates_buf: 'CURSOR_1' })
    expect(fake.of('getupdates')[1]!.body).toMatchObject({ get_updates_buf: 'CURSOR_2' })
    expect(JSON.parse(readFileSync(join(stateDir, 'ilink-session.json'), 'utf8')).getUpdatesBuf).toBe('CURSOR_2')

    const [text, voice, image, file] = received
    expect(text).toMatchObject({ id: 'id:1001', kind: 'text', text: '你好，报价单能发一下吗', addressed: true, timestamp: 1757100000_000 })
    expect(text!.source).toEqual({ channel: 'wechat-ilink', peerId: 'ilink_user_a', chatId: 'ilink_user_a', chatType: 'dm', displayName: undefined })
    expect(voice).toMatchObject({ kind: 'voice', text: '[语音] 下午三点开会' })
    expect(voice!.mediaPaths).toHaveLength(1)
    expect(readFileSync(voice!.mediaPaths![0]!).toString()).toBe('#!SILK_V3voice')
    expect(image).toMatchObject({ kind: 'text', text: '看看这张图\n[图片]' })
    expect(image!.mediaPaths?.[0]).toMatch(/media\/[a-z0-9]+_0_wechat_image_1\.jpg$/)
    expect(readFileSync(image!.mediaPaths![0]!).equals(jpeg)).toBe(true)
    expect(file).toMatchObject({ kind: 'file', text: '[文件] 合同.pdf' })
    expect(file!.mediaPaths).toBeUndefined() // download failed → described only
    expect(received.some((e) => e.text.includes('bot echo'))).toBe(false)
  })

  it('sends text split into bubbles / chunks echoing the last context_token, and media parts', async () => {
    const fake = createFakeFetch({
      notifystart: () => jsonResponse({ ret: 0 }),
      notifystop: () => jsonResponse({ ret: 0 }),
      'ilink/bot/sendmessage': () => jsonResponse({ ret: 0 }),
      'ilink/bot/getupdates': (c, n) => (n === 1 ? jsonResponse({ ret: 0, get_updates_buf: 'c', msgs: [updates.msgs[0]] }) : hang(c.signal)),
    })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(stateDir, 'ilink-session.json'), JSON.stringify({ token: 't', baseUrl: 'https://api.test', botId: 'b', userId: 'u', savedAt: 'x' }))
    const { adapter: a, received } = makeAdapter(fake)
    await a.connect()
    await waitFor(() => received.length === 1)

    const to = received[0]!.source
    const res = await a.send({ to, parts: [{ type: 'text', text: `第一条\n---wx-next---\n${'长'.repeat(4500)}` }], reason: 'agent_tool' })
    expect(res.ok).toBe(true)
    const bodies = fake.of('sendmessage').map((c) => c.body as { msg: { to_user_id: string; context_token?: string; item_list: Array<{ text_item: { text: string } }> } })
    expect(bodies).toHaveLength(3)
    expect(bodies.map((b) => b.msg.context_token)).toEqual(['ctx-a-1', 'ctx-a-1', 'ctx-a-1'])
    expect(bodies.map((b) => b.msg.to_user_id)).toEqual(['ilink_user_a', 'ilink_user_a', 'ilink_user_a'])
    expect(bodies[0]!.msg.item_list[0]!.text_item.text).toBe('第一条')
    expect(Array.from(bodies[1]!.msg.item_list[0]!.text_item.text).length).toBe(4000)
    expect(Array.from(bodies[2]!.msg.item_list[0]!.text_item.text).length).toBe(500)

    // explicit context token wins over the remembered one
    await a.send({ to, parts: [{ type: 'text', text: 'ok' }], contextToken: 'explicit', reason: 'auto_reply' })
    expect((fake.of('sendmessage')[3]!.body as { msg: { context_token: string } }).msg.context_token).toBe('explicit')

    expect(await a.send({ to: { ...to, channel: 'desktop' }, parts: [{ type: 'text', text: 'x' }], reason: 'agent_tool' })).toMatchObject({ ok: false })
    expect(await a.send({ to, parts: [{ type: 'sticker', id: 's' }], reason: 'agent_tool' })).toMatchObject({ ok: false, error: expect.stringContaining('表情') })
  })

  it('drops the session and moves to needs_login when the server reports expiry during polling', async () => {
    const fake = createFakeFetch({
      notifystart: () => jsonResponse({ ret: 0 }),
      'ilink/bot/getupdates': () => new Response('{"ret":-14,"errmsg":"session timeout"}', { status: 401 }),
    })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(stateDir, 'ilink-session.json'), JSON.stringify({ token: 't', baseUrl: 'https://api.test', botId: 'b', userId: 'u', savedAt: 'x' }))
    const { adapter: a, states } = makeAdapter(fake)
    await a.connect()
    await waitFor(() => a.state === 'needs_login')
    expect(a.session).toBeUndefined()
    expect(existsSync(join(stateDir, 'ilink-session.json'))).toBe(false)
    expect(states.at(-1)).toMatchObject({ state: 'needs_login', detail: expect.stringContaining('重新扫码') })
  })

  it('retries transient poll failures with backoff and keeps the connected state', async () => {
    const delays: number[] = []
    const fake = createFakeFetch({
      notifystart: () => jsonResponse({ ret: 0 }),
      notifystop: () => jsonResponse({ ret: 0 }),
      'ilink/bot/getupdates': (c, n) => (n <= 3 ? Promise.reject(new Error('ECONNRESET')) : hang(c.signal)),
    })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(stateDir, 'ilink-session.json'), JSON.stringify({ token: 't', baseUrl: 'https://api.test', botId: 'b', userId: 'u', savedAt: 'x' }))
    const { adapter: a } = makeAdapter(fake, {
      sleep: async (ms) => {
        delays.push(ms)
      },
    })
    await a.connect()
    await waitFor(() => fake.of('getupdates').length === 4)
    expect(delays).toEqual([3000, 6000, 12000])
    expect(a.state).toBe('connected')
  })

  it('logout forgets the session so the next connect shows a QR again', async () => {
    const fake = createFakeFetch({ notifystop: () => jsonResponse({ ret: 0 }) })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(stateDir, 'ilink-session.json'), JSON.stringify({ token: 't', baseUrl: 'https://api.test', botId: 'b', userId: 'u', savedAt: 'x' }))
    const { adapter: a } = makeAdapter(fake)
    await a.logout()
    expect(a.state).toBe('needs_login')
    expect(existsSync(join(stateDir, 'ilink-session.json'))).toBe(false)
  })

  describe('outbound media allow-list', () => {
    const session = { token: 't', baseUrl: 'https://api.test', botId: 'b', userId: 'u', savedAt: 'x' }
    const to = { channel: 'wechat-ilink' as const, chatId: 'ilink_user_a', peerId: 'ilink_user_a', chatType: 'dm' as const }
    const routes = () =>
      createFakeFetch({
        notifystart: () => jsonResponse({ ret: 0 }),
        notifystop: () => jsonResponse({ ret: 0 }),
        'ilink/bot/getuploadurl': () => jsonResponse({ upload_param: 'UP', ret: 0 }),
        '/upload?': () => new Response('', { status: 200, headers: { 'x-encrypted-param': 'DL-PARAM' } }),
        'ilink/bot/sendmessage': () => jsonResponse({ ret: 0 }),
        'ilink/bot/getupdates': (c) => hang(c.signal),
      })
    let secretDir: string
    let secret: string
    beforeEach(() => {
      secretDir = mkdtempSync(join(tmpdir(), 'ilink-secret-'))
      secret = join(secretDir, 'id_rsa')
      writeFileSync(secret, 'PRIVATE KEY')
      writeFileSync(join(stateDir, 'ilink-session.json'), JSON.stringify(session))
    })
    afterEach(() => rmSync(secretDir, { recursive: true, force: true }))

    it('by default only its own stateDir/media may be uploaded; anything else is refused before the file is read', async () => {
      const fake = routes()
      const mediaDir = join(stateDir, 'media')
      mkdirSync(mediaDir, { recursive: true })
      const ok = join(mediaDir, 'report.pdf')
      writeFileSync(ok, 'pdf bytes')
      const { adapter: a } = makeAdapter(fake)
      await a.connect()

      for (const part of [
        { type: 'file' as const, path: secret },
        { type: 'image' as const, path: join(secretDir, 'x.jpg') },
        { type: 'voice' as const, path: join(secretDir, 'x.silk') },
        { type: 'file' as const, path: join(mediaDir, '..', '..', 'id_rsa') },
        { type: 'file' as const, path: 'report.pdf' },
      ]) {
        const res = await a.send({ to, parts: [part], reason: 'agent_tool' })
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/不在允许发送的目录内|绝对路径/)
        expect(res.error).not.toContain(secretDir)
      }
      expect(fake.of('getuploadurl')).toHaveLength(0)
      expect(fake.of('/upload?')).toHaveLength(0)
      expect(fake.of('sendmessage')).toHaveLength(0)

      const res = await a.send({ to, parts: [{ type: 'file', path: ok }, { type: 'text', text: '见附件' }], reason: 'agent_tool' })
      expect(res.ok).toBe(true)
      expect(fake.of('getuploadurl')).toHaveLength(1)
      expect(fake.of('sendmessage')).toHaveLength(2)
    })

    it('allowedMediaRoots replaces the default and may be a getter', async () => {
      const fake = routes()
      const roots: string[] = []
      const { adapter: a } = makeAdapter(fake, { allowedMediaRoots: () => roots })
      await a.connect()
      const inMedia = join(stateDir, 'media', 'a.pdf')
      mkdirSync(join(stateDir, 'media'), { recursive: true })
      writeFileSync(inMedia, 'x')
      // no roots at all → fail closed, even for the adapter's own media dir
      expect(await a.send({ to, parts: [{ type: 'file', path: inMedia }], reason: 'agent_tool' })).toMatchObject({ ok: false, error: expect.stringContaining('未配置') })
      roots.push(secretDir)
      expect(await a.send({ to, parts: [{ type: 'file', path: inMedia }], reason: 'agent_tool' })).toMatchObject({ ok: false })
      expect(fake.of('getuploadurl')).toHaveLength(0)
      expect(await a.send({ to, parts: [{ type: 'file', path: secret }], reason: 'user_action' })).toMatchObject({ ok: true })
      expect(fake.of('getuploadurl')).toHaveLength(1)
    })
  })
})
