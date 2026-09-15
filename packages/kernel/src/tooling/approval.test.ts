import { describe, expect, it } from 'vitest'
import type { ChannelKind, PermissionMode, ToolRisk } from '@aiwc/protocol'
import { newApprovalId, asThreadId, asTurnId, asCallId } from '@aiwc/protocol'
import type { ApprovalVerdict } from '../ports'
import { APPROVAL_MATRIX, BOT_CHANNELS, channelVerdict, createApprovalGate, decideApproval } from './approval'

const MODES: PermissionMode[] = ['ask', 'bypass', 'autopilot']
const RISKS: ToolRisk[] = ['read', 'write', 'send', 'destructive']
const CHANNELS: ChannelKind[] = ['desktop', 'wechat-ilink', 'wechat-ui', 'cron', 'observed']

/** Reference oracle written independently of the implementation (ARCHITECTURE §6 + channel rules). */
function expected(
  mode: PermissionMode,
  risk: ToolRisk,
  channel: ChannelKind,
  toolName: string,
  allowed: boolean,
): ApprovalVerdict {
  const bot = channel === 'wechat-ilink' || channel === 'wechat-ui' || channel === 'observed'
  if (bot) {
    if (risk === 'write' || risk === 'destructive') return 'denied'
    if (risk === 'send') return toolName === 'send_message' || toolName === 'send_media' ? 'approved' : 'denied'
  }
  if (channel === 'cron') {
    // Nobody to ask: reads and memory writes run; the mode (or an allow-list grant) decides the rest, never a prompt.
    if (risk === 'read') return 'approved'
    if (risk === 'write' && (toolName.startsWith('remember') || toolName.startsWith('memory_'))) return 'approved'
    if (risk === 'destructive') return 'denied'
    if (allowed) return 'approved'
    if (risk === 'write') return mode === 'ask' ? 'denied' : 'approved'
    return mode === 'autopilot' ? 'approved' : 'denied'
  }
  // Destructive always asks; reads always run; writes ask only in Ask mode (unless allow-listed);
  // sends run without asking only in Autopilot.
  if (risk === 'read') return 'approved'
  if (risk === 'write') return mode !== 'ask' || allowed ? 'approved' : 'ask'
  if (risk === 'send') return mode === 'autopilot' ? 'approved' : 'ask'
  return 'ask'
}

describe('APPROVAL_MATRIX', () => {
  it('matches ARCHITECTURE §6 exactly', () => {
    expect(APPROVAL_MATRIX).toEqual({
      ask: { read: 'approved', write: 'allow_list', send: 'ask', destructive: 'ask' },
      bypass: { read: 'approved', write: 'approved', send: 'ask', destructive: 'ask' },
      autopilot: { read: 'approved', write: 'approved', send: 'approved', destructive: 'ask' },
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

describe('per-call allow keys', () => {
  it('a grant for the tool covers every key; a key grant covers only that key', () => {
    const base = { toolName: 'shell', risk: 'write' as const, mode: 'ask' as const, channel: 'desktop' as const }
    expect(decideApproval({ ...base, allowKey: 'shell:git commit', allowAlways: ['shell'] })).toBe('approved')
    expect(decideApproval({ ...base, allowKey: 'shell:git commit', allowAlways: ['shell:git commit'] })).toBe(
      'approved',
    )
    expect(decideApproval({ ...base, allowKey: 'shell:rm', allowAlways: ['shell:git commit'] })).toBe('ask')
  })

  it('destructive calls are never allow-listed, even on a scheduled thread that granted the tool', () => {
    expect(
      decideApproval({
        toolName: 'shell',
        allowKey: 'shell:rm -rf',
        risk: 'destructive',
        mode: 'bypass',
        channel: 'desktop',
        allowAlways: ['shell'],
      }),
    ).toBe('ask')
    expect(
      decideApproval({
        toolName: 'shell',
        allowKey: 'shell:rm -rf',
        risk: 'destructive',
        mode: 'ask',
        channel: 'cron',
        allowAlways: ['shell'],
      }),
    ).toBe('denied')
  })

  it('a scheduled thread runs what its mode covers without asking, and denies the rest', () => {
    const cron = { channel: 'cron' as const, allowAlways: [] }
    expect(decideApproval({ ...cron, mode: 'autopilot', toolName: 'office_push_table', risk: 'send' })).toBe('approved')
    expect(decideApproval({ ...cron, mode: 'bypass', toolName: 'office_push_table', risk: 'send' })).toBe('denied')
    expect(
      decideApproval({ ...cron, mode: 'bypass', toolName: 'shell', allowKey: 'shell:lark-cli base', risk: 'write' }),
    ).toBe('approved')
    expect(
      decideApproval({ ...cron, mode: 'ask', toolName: 'shell', allowKey: 'shell:lark-cli base', risk: 'write' }),
    ).toBe('denied')
    expect(
      decideApproval({
        ...cron,
        mode: 'ask',
        toolName: 'shell',
        allowKey: 'shell:lark-cli base',
        risk: 'write',
        allowAlways: ['shell:lark-cli base'],
      }),
    ).toBe('approved')
    expect(
      decideApproval({ ...cron, mode: 'autopilot', toolName: 'shell', allowKey: 'shell:rm -rf', risk: 'destructive' }),
    ).toBe('denied')
    expect(decideApproval({ ...cron, mode: 'ask', toolName: 'shell', allowKey: 'shell:ls', risk: 'read' })).toBe(
      'approved',
    )
  })
})

describe('legacy permission modes', () => {
  it("a thread persisted with the removed 'plan' mode asks instead of throwing", () => {
    const mode = 'plan' as unknown as PermissionMode
    expect(decideApproval({ toolName: 'note_write', risk: 'write', mode, channel: 'desktop', allowAlways: [] })).toBe(
      'ask',
    )
    expect(decideApproval({ toolName: 'lookup', risk: 'read', mode, channel: 'desktop', allowAlways: [] })).toBe(
      'approved',
    )
    expect(decideApproval({ toolName: 'send_message', risk: 'send', mode, channel: 'desktop', allowAlways: [] })).toBe(
      'ask',
    )
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
