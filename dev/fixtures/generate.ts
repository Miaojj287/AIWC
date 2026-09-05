/**
 * Demo dataset generator.
 *
 *   node --experimental-strip-types dev/fixtures/generate.ts [--seed=20260901] [--now=<ISO>] [--out=<path>]
 *
 * Deterministic for a given (seed, now). Produces 26 dm + 14 group sessions, 60 contacts and roughly
 * 6 000 messages over the last 90 days. Never uses names from the design mock (CLAUDE.md §7).
 * Only type imports come from @aiwc/protocol so the file runs without a bundler.
 */
import type { WxAccount, WxContact, WxMessage, WxSession } from '@aiwc/protocol'
import type { DemoFixture } from './types.ts'
import { createRng, type Rng } from './prng.ts'
import {
  FORBIDDEN_NAMES,
  GIVEN_NAMES,
  GROUP_TEMPLATES,
  HANDLES,
  REMARK_PATTERNS,
  SELF_NICKNAMES,
  SURNAMES,
  type GroupTemplate,
} from './corpus.ts'
import {
  buildDmBurst,
  buildGroupBurst,
  pickBurstStart,
  profileFor,
  systemLine,
  type DraftMessage,
  type Participant,
} from './conversations.ts'

export interface GenerateOptions {
  seed?: number
  /** "current time" of the dataset; the newest message lands a few minutes before it */
  now?: number
  days?: number
  dmSessions?: number
  groupSessions?: number
  contacts?: number
}

export const DEFAULT_SEED = 20260901

const DAY = 86_400_000
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789'

function alnum(rng: Rng, n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += ALNUM[rng.int(0, ALNUM.length - 1)]
  return s
}

function digits(rng: Rng, n: number): string {
  let s = String(rng.int(1, 9))
  for (let i = 1; i < n; i++) s += String(rng.int(0, 9))
  return s
}

function uniqueNames(rng: Rng, count: number): Array<{ full: string; surname: string; given: string }> {
  const seen = new Set<string>()
  const out: Array<{ full: string; surname: string; given: string }> = []
  while (out.length < count) {
    const surname = rng.pick(SURNAMES)
    const given = rng.pick(GIVEN_NAMES)
    const full = surname + given
    if (seen.has(full) || FORBIDDEN_NAMES.has(full)) continue
    seen.add(full)
    out.push({ full, surname, given })
  }
  return out
}

function makeContacts(rng: Rng, count: number, now: number): WxContact[] {
  return uniqueNames(rng, count).map(({ full, surname, given }) => {
    const c: WxContact = { username: `wxid_${alnum(rng, 14)}`, nickname: full, kind: 'friend' }
    if (rng.chance(0.35)) c.remark = rng.pick(REMARK_PATTERNS)(surname, given)
    if (rng.chance(0.4)) c.alias = `${rng.pick(HANDLES)}${rng.chance(0.6) ? digits(rng, rng.int(2, 4)) : ''}`
    if (rng.chance(0.15)) c.lastContactAt = now - rng.int(1, 200) * DAY
    return c
  })
}

/** Activity tiers: how many messages a session gets. */
function tiers(rng: Rng, spec: Array<[count: number, perSession: number]>): number[] {
  const out: number[] = []
  for (const [count, per] of spec) for (let i = 0; i < count; i++) out.push(Math.round(per * rng.bell(0.75, 1.25)))
  return rng.shuffle(out)
}

interface SessionDraft {
  session: WxSession
  drafts: DraftMessage[]
}

function previewFor(m: WxMessage): string {
  switch (m.kind) {
    case 'image':
      return '[图片]'
    case 'video':
      return '[视频]'
    case 'voice':
      return `[语音] ${Math.max(1, Math.round((m.media?.durationMs ?? 0) / 1000))}"`
    case 'sticker':
      return '[动画表情]'
    case 'file':
      return `[文件] ${m.media?.fileName ?? ''}`.trim()
    case 'link':
      return `[链接] ${m.text}`
    default:
      return m.text
  }
}

function finalise(draft: SessionDraft, sessionIndex: number, account: WxAccount): WxMessage[] {
  const sorted = [...draft.drafts].sort((a, b) => a.createdAt - b.createdAt)
  const messages: WxMessage[] = sorted.map((d, i) => {
    const seq = i + 1
    const id = `m${sessionIndex}-${seq}`
    const msg: WxMessage = {
      id,
      sessionId: draft.session.id,
      seq,
      createdAt: d.createdAt,
      senderId: d.sender ? d.sender.id : 'system',
      isSelf: d.sender?.isSelf ?? false,
      kind: d.kind,
      text: d.text,
      anchor: { sessionId: draft.session.id, messageId: id, seq, createdAt: d.createdAt },
    }
    if (d.sender) msg.senderName = d.sender.isSelf ? account.nickname : d.sender.name
    if (d.media) msg.media = d.media
    if (d.quote) msg.quote = d.quote
    return msg
  })
  const last = messages[messages.length - 1]
  if (last) {
    draft.session.lastMessageAt = last.createdAt
    draft.session.lastPreview = previewFor(last)
    if (draft.session.kind === 'group' && last.senderName) draft.session.lastSender = last.senderName
    draft.session.indexedCount = messages.length
    draft.session.indexedUntil = last.createdAt
  }
  return messages
}

export function generateDataset(opts: GenerateOptions = {}): DemoFixture {
  const seed = opts.seed ?? DEFAULT_SEED
  const now = opts.now ?? Date.now()
  const days = opts.days ?? 90
  const dmCount = opts.dmSessions ?? 26
  const groupCount = opts.groupSessions ?? 14
  const contactCount = opts.contacts ?? 60
  const rng = createRng(seed)

  const account: WxAccount = {
    wxid: `wxid_${alnum(rng, 14)}`,
    nickname: rng.pick(SELF_NICKNAMES),
    dbRoot: '',
    verified: true,
  }
  account.dbRoot = `/Users/demo/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/${account.wxid}`
  const me: Participant = { id: account.wxid, name: account.nickname ?? '我', isSelf: true }

  const contacts = makeContacts(rng, contactCount, now)
  const participantOf = (c: WxContact): Participant => ({ id: c.username, name: c.nickname, isSelf: false })
  const dmContacts = rng.sample(contacts, dmCount)

  const drafts: SessionDraft[] = []

  // ---- 1:1 sessions --------------------------------------------------------------------------
  const dmQuota = tiers(rng, [
    [Math.max(1, Math.round(dmCount * 0.19)), 280],
    [Math.round(dmCount * 0.38), 100],
    [dmCount - Math.max(1, Math.round(dmCount * 0.19)) - Math.round(dmCount * 0.38), 30],
  ])
  dmContacts.forEach((contact, i) => {
    const quota = dmQuota[i] ?? 30
    const peer = participantOf(contact)
    const profile = profileFor('dm')
    const bursts: DraftMessage[] = []
    let earliest = now
    while (bursts.length < quota) {
      const start = pickBurstStart(rng, now, days, profile)
      earliest = Math.min(earliest, start)
      bursts.push(...buildDmBurst(rng, me, peer, start, now))
    }
    if (rng.chance(0.3)) {
      const sys = systemLine(rng, 'dm', [contact.nickname], earliest - rng.int(1, 30) * 60_000)
      if (sys) bursts.push(sys)
    }
    const session: WxSession = {
      id: contact.username,
      kind: 'dm',
      title: contact.remark ?? contact.nickname,
      unread: 0,
      pinned: false,
      muted: false,
    }
    drafts.push({ session, drafts: bursts })
  })

  // ---- group sessions ------------------------------------------------------------------------
  const groupMembers: Record<string, string[]> = {}
  const templates: GroupTemplate[] = rng.sample(GROUP_TEMPLATES, groupCount)
  const groupQuota = tiers(rng, [
    [Math.max(1, Math.round(groupCount * 0.28)), 420],
    [Math.round(groupCount * 0.43), 200],
    [groupCount - Math.max(1, Math.round(groupCount * 0.28)) - Math.round(groupCount * 0.43), 60],
  ])
  templates.forEach((tpl, i) => {
    const quota = groupQuota[i] ?? 60
    const id = `${digits(rng, rng.int(8, 10))}@chatroom`
    const size = quota > 300 ? rng.int(24, 40) : quota > 120 ? rng.int(10, 24) : rng.int(5, 10)
    const members = rng.sample(contacts, Math.min(size, contacts.length))
    groupMembers[id] = [account.wxid, ...members.map((m) => m.username)]
    const speakerCount = Math.min(rng.int(3, 8), members.length)
    const speakers = rng.sample(members, speakerCount).map(participantOf)
    if (rng.chance(0.7)) speakers.push(me)
    const profile = profileFor(tpl.flavor)
    const bursts: DraftMessage[] = []
    while (bursts.length < quota) {
      const start = pickBurstStart(rng, now, days, profile)
      bursts.push(...buildGroupBurst(rng, tpl.flavor, speakers, start, now))
    }
    const systemCount = rng.int(1, 3)
    for (let k = 0; k < systemCount; k++) {
      const sys = systemLine(rng, 'group', members.map((m) => m.nickname), pickBurstStart(rng, now, days, profile))
      if (sys) bursts.push(sys)
    }
    const session: WxSession = {
      id,
      kind: 'group',
      title: tpl.title,
      unread: 0,
      pinned: false,
      muted: false,
      memberCount: groupMembers[id]?.length ?? 0,
    }
    drafts.push({ session, drafts: bursts })
  })

  // ---- flags & derived fields ----------------------------------------------------------------
  const messages: WxMessage[] = []
  drafts.forEach((d, i) => messages.push(...finalise(d, i, account)))

  const sessions = drafts.map((d) => d.session)
  const groups = sessions.filter((s) => s.kind === 'group')
  const dms = sessions.filter((s) => s.kind === 'dm')
  for (const s of rng.sample(dms, 2)) s.pinned = true
  for (const s of rng.sample(groups, 2)) s.pinned = true
  for (const s of rng.sample(groups.filter((g) => !g.pinned), 4)) s.muted = true
  for (const s of rng.sample(dms.filter((g) => !g.pinned), 1)) s.muted = true
  for (const s of sessions) {
    if (s.muted) s.unread = rng.chance(0.7) ? rng.int(3, 60) : 0
    else s.unread = rng.chance(0.35) ? rng.int(1, 9) : 0
    // a session whose last message is mine cannot be unread
    const last = messages.filter((m) => m.sessionId === s.id).at(-1)
    if (last?.isSelf) s.unread = 0
  }
  sessions.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))

  const lastByContact = new Map<string, number>()
  for (const m of messages) {
    if (m.isSelf || m.senderId === 'system') continue
    lastByContact.set(m.senderId, Math.max(lastByContact.get(m.senderId) ?? 0, m.createdAt))
  }
  for (const c of contacts) {
    const t = lastByContact.get(c.username)
    if (t) c.lastContactAt = t
  }

  return { version: 1, account, sessions, contacts, groupMembers, messages }
}

// ---- CLI runner ---------------------------------------------------------------------------------
async function main(): Promise<void> {
  const { writeFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const { dirname, resolve } = await import('node:path')
  const args = new Map<string, string>()
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-z]+)=(.*)$/.exec(a)
    if (m && m[1] !== undefined) args.set(m[1], m[2] ?? '')
  }
  const seed = args.has('seed') ? Number(args.get('seed')) : DEFAULT_SEED
  const nowArg = args.get('now')
  const now = nowArg ? new Date(nowArg).getTime() : Math.floor(Date.now() / 60_000) * 60_000
  const here = dirname(fileURLToPath(import.meta.url))
  const out = resolve(here, args.get('out') ?? 'demo-dataset.json')

  const fixture = generateDataset({ seed, now })
  const json = JSON.stringify(fixture)
  writeFileSync(out, json + '\n', 'utf8')
  const kinds = new Map<string, number>()
  for (const m of fixture.messages) kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1)
  console.log(
    `wrote ${out}\n  seed=${seed} now=${new Date(now).toISOString()}\n  sessions=${fixture.sessions.length} contacts=${fixture.contacts.length} messages=${fixture.messages.length} bytes=${Buffer.byteLength(json)}\n  kinds=${JSON.stringify(Object.fromEntries(kinds))}`,
  )
}

const entry = process.argv[1]
if (entry && /generate\.(ts|js|mjs)$/.test(entry)) {
  const { pathToFileURL } = await import('node:url')
  if (pathToFileURL(entry).href === import.meta.url) await main()
}
