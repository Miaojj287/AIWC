/**
 * mobile:* for the mock bridge (tests + browser previews): a scripted QR login (code → scanned → connected as a
 * demo owner), the remote-control switch and an in-memory audit list. Nothing here is used by the desktop app.
 */
import type { MobileSendRecord, MobileStatus } from '@aiwc/protocol'
import type { HandlersFor, MockContext } from './core'
import { qrPlaceholderSvg } from './media'

const DEMO_OWNER = 'o9cq…demo'
const SENDS_LIMIT = 50

export function mobileHandlers(ctx: MockContext): HandlersFor<'mobile'> {
  let status: MobileStatus = {
    state: 'needs_login',
    scanned: false,
    ownerUnknown: false,
    persisted: true,
    remote: { enabled: false, permissionMode: 'ask', running: false, pendingApprovals: 0 },
  }
  const sends: MobileSendRecord[] = []
  let loginSeq = 0

  const set = (patch: Partial<MobileStatus>): MobileStatus => {
    status = { ...status, ...patch }
    ctx.emit('mobile:changed', status)
    return status
  }

  async function login(seq: number): Promise<void> {
    await ctx.delay(400)
    if (seq !== loginSeq) return
    set({ qrDataUrl: qrPlaceholderSvg(`mobile:${ctx.now()}`) })
    await ctx.delay(3000)
    if (seq !== loginSeq) return
    set({ qrDataUrl: undefined, scanned: true })
    await ctx.delay(1500)
    if (seq !== loginSeq) return
    set({ state: 'connected', scanned: false, owner: DEMO_OWNER })
  }

  return {
    'mobile:status': () => status,
    'mobile:connect': () => {
      if (status.state === 'connected' || status.state === 'connecting') return status
      const seq = ++loginSeq
      void login(seq).catch(() => undefined)
      return set({ state: status.owner ? 'connected' : 'connecting', detail: undefined })
    },
    'mobile:cancelLogin': () => {
      loginSeq++
      return set({ state: 'needs_login', qrDataUrl: undefined, scanned: false })
    },
    'mobile:disconnect': () => {
      loginSeq++
      return set({ state: 'needs_login', owner: undefined, qrDataUrl: undefined, scanned: false })
    },
    'mobile:setRemote': (req) => set({ remote: { ...status.remote, ...req } }),
    'mobile:test': () => {
      const record: MobileSendRecord = status.owner
        ? { at: ctx.now(), kind: 'notice', ok: true, chars: 24 }
        : { at: ctx.now(), kind: 'notice', ok: false, chars: 24, error: 'My WeChat is not connected' }
      sends.unshift(record)
      sends.length = Math.min(sends.length, SENDS_LIMIT)
      set({ lastSend: record })
      return record
    },
    'mobile:sends': (req) => sends.slice(0, req?.limit ?? 10),
  }
}
