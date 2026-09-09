/**
 * Stateless iLink HTTP client. Every call takes the session explicitly; connection state, loops and
 * persistence live in adapter.ts. `fetch` is injectable so tests never touch the network.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import {
  ILINK_APP_ID,
  ILINK_BASE_URL,
  ILINK_BOT_AGENT,
  ILINK_BOT_TYPE,
  ILINK_CHANNEL_VERSION,
  MessageItemType,
  UploadMediaType,
  buildClientVersion,
  type IlinkConfigResp,
  type IlinkMessageItem,
  type IlinkQrStatusResp,
  type IlinkQrcode,
  type IlinkSession,
  type IlinkUpdates,
  type IlinkUploadUrlResp,
} from './protocol'
import { MEDIA_LIMITS, aesEcbPaddedSize, buildCdnUploadUrl, prepareUpload, uploadEncryptedMedia, type FetchLike, type UploadedMedia } from './media'

export interface IlinkClientOptions {
  fetch?: FetchLike
  /** Base url for login endpoints (before a session exists). */
  loginBaseUrl?: string
  defaultTimeoutMs?: number
  /** Randomness override for deterministic tests. */
  random?: { bytes(n: number): Buffer; uuid(): string }
}

export interface SendMessageResult {
  clientId: string
  ret?: number
  errmsg?: string
}

export interface IlinkClient {
  fetchQrcode(): Promise<IlinkQrcode>
  fetchQrcodeStatus(qrcode: string): Promise<IlinkQrStatusResp>
  notifyStart(session: IlinkSession): Promise<{ ret?: number; errmsg?: string } | null>
  notifyStop(session: IlinkSession): Promise<{ ret?: number; errmsg?: string } | null>
  /** Long-poll (server holds ~35s). Resolves with an empty update on timeout/abort. */
  getUpdates(session: IlinkSession, buf: string, signal?: AbortSignal): Promise<IlinkUpdates>
  getConfig(session: IlinkSession, userId: string, contextToken?: string): Promise<IlinkConfigResp | null>
  sendTyping(session: IlinkSession, userId: string, ticket: string, status: 1 | 2): Promise<void>
  sendText(session: IlinkSession, toUserId: string, text: string, contextToken?: string): Promise<SendMessageResult>
  sendItems(session: IlinkSession, toUserId: string, items: IlinkMessageItem[], contextToken?: string): Promise<SendMessageResult>
  sendImage(session: IlinkSession, toUserId: string, filePath: string, contextToken?: string): Promise<SendMessageResult>
  sendFile(session: IlinkSession, toUserId: string, filePath: string, contextToken?: string): Promise<SendMessageResult>
  sendVideo(session: IlinkSession, toUserId: string, filePath: string, contextToken?: string): Promise<SendMessageResult>
  sendVoice(session: IlinkSession, toUserId: string, filePath: string, opts: { playtimeMs: number; sampleRate?: number; text?: string; contextToken?: string }): Promise<SendMessageResult>
  uploadMedia(session: IlinkSession, toUserId: string, filePath: string, mediaType: number, maxBytes: number): Promise<UploadedMedia>
}

const CLIENT_VERSION_HEADER = String(buildClientVersion(ILINK_CHANNEL_VERSION))

export function commonHeaders(): Record<string, string> {
  return { 'iLink-App-Id': ILINK_APP_ID, 'iLink-App-ClientVersion': CLIENT_VERSION_HEADER }
}

export function buildBaseInfo(): Record<string, string> {
  return { channel_version: ILINK_CHANNEL_VERSION, bot_agent: ILINK_BOT_AGENT }
}

/** X-WECHAT-UIN: random uint32 → decimal string → base64, fresh per request. */
export function randomWechatUin(bytes: (n: number) => Buffer): string {
  const uint32 = bytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), 'utf8').toString('base64')
}

export function buildPostHeaders(token: string | undefined, bytes: (n: number) => Buffer): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(bytes),
    ...commonHeaders(),
  }
  // Never set Content-Length by hand: undici computes it and rejects a mismatch.
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

/** Exact wire shape of a sendmessage body — kept as a pure function so tests can pin it. */
export function buildSendMessageBody(toUserId: string, items: IlinkMessageItem[], clientId: string, contextToken?: string): Record<string, unknown> {
  return {
    msg: {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2, // BOT
      message_state: 2, // FINISH
      context_token: contextToken,
      item_list: items,
    },
  }
}

export function toCdnMedia(uploaded: UploadedMedia): { encrypt_query_param: string; aes_key: string; encrypt_type: number } {
  return { encrypt_query_param: uploaded.encryptedQueryParam, aes_key: Buffer.from(uploaded.aeskey).toString('base64'), encrypt_type: 1 }
}

export function createIlinkClient(opts: IlinkClientOptions = {}): IlinkClient {
  const fetchImpl: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init))
  const loginBase = (opts.loginBaseUrl ?? ILINK_BASE_URL).replace(/\/$/, '')
  const defaultTimeout = opts.defaultTimeoutMs ?? 15_000
  const random = opts.random ?? { bytes: (n: number) => randomBytes(n), uuid: () => randomUUID() }

  async function apiGet<T>(path: string): Promise<T> {
    const res = await fetchImpl(`${loginBase}/${path}`, { headers: commonHeaders() })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
    return JSON.parse(text) as T
  }

  /** POST with base_info; resolves null on timeout/abort (normal for long polls). */
  async function apiPost<T>(baseUrl: string, endpoint: string, body: Record<string, unknown>, token?: string, timeoutMs = defaultTimeout, signal?: AbortSignal): Promise<T | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onAbort = (): void => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      if (signal?.aborted) return null
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/${endpoint}`, {
        method: 'POST',
        headers: buildPostHeaders(token, random.bytes),
        body: JSON.stringify({ ...body, base_info: buildBaseInfo() }),
        signal: controller.signal,
      })
      const text = await res.text()
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
      return text ? (JSON.parse(text) as T) : ({} as T)
    } catch (err) {
      if ((err as Error | undefined)?.name === 'AbortError') return null
      throw err
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  async function sendItems(session: IlinkSession, toUserId: string, items: IlinkMessageItem[], contextToken?: string): Promise<SendMessageResult> {
    const clientId = `aiwc-${random.uuid()}`
    const resp = await apiPost<{ ret?: number; errmsg?: string }>(session.baseUrl, 'ilink/bot/sendmessage', buildSendMessageBody(toUserId, items, clientId, contextToken), session.token)
    if (resp && resp.ret !== undefined && resp.ret !== 0) throw new Error(`sendmessage ret=${resp.ret} ${resp.errmsg ?? ''}`.trim())
    return { clientId, ret: resp?.ret, errmsg: resp?.errmsg }
  }

  async function uploadMedia(session: IlinkSession, toUserId: string, filePath: string, mediaType: number, maxBytes: number): Promise<UploadedMedia> {
    const prepared = await prepareUpload(filePath, maxBytes, () => random.bytes(16))
    const resp = await apiPost<IlinkUploadUrlResp>(
      session.baseUrl,
      'ilink/bot/getuploadurl',
      {
        filekey: prepared.filekey,
        media_type: mediaType,
        to_user_id: toUserId,
        rawsize: prepared.plaintext.length,
        rawfilemd5: prepared.rawFileMd5,
        filesize: aesEcbPaddedSize(prepared.plaintext.length),
        no_need_thumb: true,
        aeskey: prepared.aeskey.toString('hex'),
      },
      session.token,
    )
    const fullUrl = resp?.upload_full_url?.trim()
    const param = resp?.upload_param
    if (!fullUrl && !param) throw new Error('getuploadurl 未返回上传地址')
    const uploadUrl = fullUrl || buildCdnUploadUrl(session.baseUrl, String(param), prepared.filekey)
    const encryptedQueryParam = await uploadEncryptedMedia(fetchImpl, uploadUrl, prepared.encrypted)
    return {
      filekey: prepared.filekey,
      encryptedQueryParam,
      aeskey: prepared.aeskey.toString('hex'),
      fileSize: prepared.plaintext.length,
      fileSizeCiphertext: prepared.encrypted.length,
      rawFileMd5: prepared.rawFileMd5,
    }
  }

  return {
    async fetchQrcode() {
      const resp = await apiGet<{ qrcode: string; qrcode_img_content: string }>(`ilink/bot/get_bot_qrcode?bot_type=${ILINK_BOT_TYPE}`)
      return { qrcode: resp.qrcode, qrcodeContent: resp.qrcode_img_content }
    },
    fetchQrcodeStatus: (qrcode) => apiGet<IlinkQrStatusResp>(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`),
    notifyStart: (session) => apiPost(session.baseUrl, 'ilink/bot/msg/notifystart', {}, session.token, 10_000),
    notifyStop: (session) => apiPost(session.baseUrl, 'ilink/bot/msg/notifystop', {}, session.token, 10_000),
    async getUpdates(session, buf, signal) {
      const resp = await apiPost<IlinkUpdates>(session.baseUrl, 'ilink/bot/getupdates', { get_updates_buf: buf ?? '' }, session.token, 38_000, signal)
      return resp ?? { ret: 0, msgs: [], get_updates_buf: buf }
    },
    getConfig: (session, userId, contextToken) => apiPost<IlinkConfigResp>(session.baseUrl, 'ilink/bot/getconfig', { ilink_user_id: userId, context_token: contextToken }, session.token, 10_000),
    async sendTyping(session, userId, ticket, status) {
      await apiPost(session.baseUrl, 'ilink/bot/sendtyping', { ilink_user_id: userId, typing_ticket: ticket, status }, session.token, 10_000)
    },
    sendText: (session, toUserId, text, contextToken) => sendItems(session, toUserId, [{ type: MessageItemType.TEXT, text_item: { text } }], contextToken),
    sendItems,
    async sendImage(session, toUserId, filePath, contextToken) {
      const uploaded = await uploadMedia(session, toUserId, filePath, UploadMediaType.IMAGE, MEDIA_LIMITS.image)
      return sendItems(session, toUserId, [{ type: MessageItemType.IMAGE, image_item: { media: toCdnMedia(uploaded), mid_size: uploaded.fileSizeCiphertext } }], contextToken)
    },
    async sendFile(session, toUserId, filePath, contextToken) {
      const uploaded = await uploadMedia(session, toUserId, filePath, UploadMediaType.FILE, MEDIA_LIMITS.file)
      return sendItems(session, toUserId, [{ type: MessageItemType.FILE, file_item: { media: toCdnMedia(uploaded), file_name: basename(filePath), len: String(uploaded.fileSize) } }], contextToken)
    },
    async sendVideo(session, toUserId, filePath, contextToken) {
      const uploaded = await uploadMedia(session, toUserId, filePath, UploadMediaType.VIDEO, MEDIA_LIMITS.video)
      return sendItems(session, toUserId, [{ type: MessageItemType.VIDEO, video_item: { media: toCdnMedia(uploaded), video_size: uploaded.fileSizeCiphertext } }], contextToken)
    },
    async sendVoice(session, toUserId, filePath, o) {
      const uploaded = await uploadMedia(session, toUserId, filePath, UploadMediaType.VOICE, MEDIA_LIMITS.voice)
      return sendItems(
        session,
        toUserId,
        [
          {
            type: MessageItemType.VOICE,
            voice_item: {
              media: toCdnMedia(uploaded),
              encode_type: 6,
              bits_per_sample: 16,
              sample_rate: o.sampleRate ?? 24000,
              playtime: Math.max(1, Math.round(o.playtimeMs)),
              text: o.text,
            },
          },
        ],
        o.contextToken,
      )
    },
    uploadMedia,
  }
}
