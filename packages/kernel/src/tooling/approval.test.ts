import { describe, expect, it } from 'vitest'
import type { ChannelKind, PermissionMode, ToolRisk } from '@aiwc/protocol'
import { newApprovalId, asThreadId, asTurnId, asCallId } from '@aiwc/protocol'
import type { ApprovalVerdict } from '../ports'
import { APPROVAL_MATRIX, BOT_CHANNELS, channelVerdict, createApprovalGate, decideApproval } from './approval'

const MODES: PermissionMode[] = ['ask', 'bypass']
const RISKS: ToolRisk[] = ['read', 'write', 'send', 'destructive']
const CHANNELS: ChannelKind[] = ['desktop', 'wechat-ilink', 'wechat-ui', 'cron', 'observed']

/** Reference oracle written independently of the implementation (ARCHITECTURE §6 + channel rules). */
function expected(mode: PermissionMode, risk: ToolRisk, channel: ChannelKind, toolName: string, allowed: boolean): ApprovalVerdict {
  const bot = channel === 'wechat-ilink' || channel === 'wechat-ui' || channel === 'observed'
  if (bot) {
    if (risk === 'write' || risk === 'destructive') return 'denied'
    if (risk === 'send') return toolName === 'send_message' || toolName === 'send_media' ? 'approved' : 'denied'
  }
  if (channel === 'cron') {
    if (risk === 'write') return toolName.startsWith('remember') || toolName.startsWith('memory_') ? 'approved' : 'denied'
    if (risk === 'send' || risk === 'destructive') return 'denied'
  }
  // Only send / destructive ever ask; reads always run; writes ask in Ask mode unless allow-listed.
  if (risk === 'read') return 'approved'
  if (risk === 'write') return mode === 'bypass' || allowed ? 'approved' : 'ask'
  return 'ask'
}

describe('APPROVAL_MATRIX', () => {
  it('matches ARCHITECTURE §6 exactly', () => {
    expect(APPROVAL_MATRIX).toEqual({
      ask: { read: 'approved', write: 'allow_list', send: 'ask', destructive: 'ask' },
      bypass: { read: 'approved', write: 'approved', send: 'ask', destructive: 'ask' },
    })
  })

  const cases: Array<[PermissionMode, ToolRisk, ChannelKind, string, boolean]> = []
  for (const mode of MODES)
    for (const risk of RISKS)
      for (const channel of CHANNELS)
        for (const toolName of ['generic_tool', 'send_message', 'send_media', 'remember', 'memory_write'])
          for (const allowed of [false, true]) cases.push([mode, risk, channel, toolName, allowed])

  it.each(cases)('%s × %s × %s × %s (allowAlways=%s)', (mode, risk, channel, toolName, allowed) => {
    const verdict = decideApproval({ toolName, risk, mode, channel, allowAlways: allowed ? [toolName] : [] })
    expect(verdict).toBe(expected(mode, risk, channel, toolName, allowed))
  })
})

describe('legacy permission modes', () => {
  it("a thread persisted with the removed 'plan' mode asks instead of throwing", () => {
    const mode = 'plan' as unknown as PermissionMode
    expect(decideApproval({ toolName: 'note_write', risk: 'write', mode, channel: 'desktop', allowAlways: [] })).toBe('ask')
    expect(decideApproval({ toolName: 'lookup', risk: 'read', mode, channel: 'desktop', allowAlways: [] })).toBe('approved')
    expect(decideApproval({ toolName: 'send_message', risk: 'send', mode, channel: 'desktop', allowAlways: [] })).toBe('ask')
  })
})

describe('channelVerdict', () => {
  it("'observed' is a bot channel", () => {
    expect(BOT_CHANNELS).toContain('observed')
  })

  const rows: Array<[ChannelKind, string, ToolRisk, ApprovalVerdict | undefined]> = [
    ['observed', 'generic_tool', 'read', undefined],
    ['observed', 'generic_tool', 'write', 'denied'],
    ['observed', 'generic_tool', 'destructive', 'denied'],
    ['observed', 'generic_tool', 'send', 'denied'],
    ['observed', 'send_message', 'send', 'approved'],
    ['observed', 'send_media', 'send', 'approved'],
    ['wechat-ilink', 'send_message', 'send', 'approved'],
    ['wechat-ui', 'send_media', 'send', 'approved'],
    ['wechat-ui', 'send_email', 'send', 'denied'],
    ['cron', 'remember', 'write', 'approved'],
    ['cron', 'write_file', 'write', 'denied'],
    ['cron', 'send_message', 'send', 'denied'],
    ['desktop', 'send_message', 'send', undefined],
  ]
  it.each(rows)('%s × %s × %s → %s', (channel, toolName, risk, verdict) => {
    expect(channelVerdict(channel, toolName, risk)).toBe(verdict)
  })
})

describe('createApprovalGate ask/resolve/cancelAll', () => {
  const req = (threadId = 'thr_a') => ({
    approvalId: newApprovalId(),
    threadId: asThreadId(threadId),
    turnId: asTurnId('trn_1'),
    callId: asCallId('cal_1'),
    toolName: 'x',
    summary: 'x',
    input: {},
    risk: 'write' as const,
    canAllowAlways: true,
  })

  it('resolve fulfils the pending ask and returns true once', async () => {
    const gate = createApprovalGate()
    const r = req()
    const p = gate.ask(r, new AbortController().signal)
    expect(gate.resolve(r.approvalId, 'allow_always')).toBe(true)
    await expect(p).resolves.toBe('allow_always')
    expect(gate.resolve(r.approvalId, 'deny')).toBe(false)
  })

  it('resolve with a threadId refuses another thread and leaves the ask pending', async () => {
    const gate = createApprovalGate()
    const r = req('thr_a')
    const p = gate.ask(r, new AbortController().signal)
    expect(gate.resolve(r.approvalId, 'allow_once', asThreadId('thr_b'))).toBe(false)
    expect(gate.resolve(r.approvalId, 'allow_once', asThreadId('thr_a'))).toBe(true)
    await expect(p).resolves.toBe('allow_once')
  })

  it('unknown approvalId → false', () => {
    expect(createApprovalGate().resolve(newApprovalId(), 'deny')).toBe(false)
  })

  it('abort signal → deny', async () => {
    const gate = createApprovalGate()
    const ac = new AbortController()
    const p = gate.ask(req(), ac.signal)
    ac.abort()
    await expect(p).resolves.toBe('deny')
  })

  it('already-aborted signal → deny immediately', async () => {
    const gate = createApprovalGate()
    const ac = new AbortController()
    ac.abort()
    await expect(gate.ask(req(), ac.signal)).resolves.toBe('deny')
  })

  it('cancelAll denies only the given thread', async () => {
    const gate = createApprovalGate()
    const a = req('thr_a')
    const b = req('thr_b')
    const pa = gate.ask(a, new AbortController().signal)
    const pb = gate.ask(b, new AbortController().signal)
    gate.cancelAll(asThreadId('thr_a'))
    await expect(pa).resolves.toBe('deny')
    expect(gate.resolve(b.approvalId, 'allow_once')).toBe(true)
    await expect(pb).resolves.toBe('allow_once')
  })
})
