import { describe, expect, it } from 'vitest'
import { decisionForChoice, parseRemoteCommand } from './remoteCommands'

describe('parseRemoteCommand', () => {
  it.each([
    ['/状态', 'status'],
    ['/status', 'status'],
    ['/STATUS', 'status'],
    ['／状态', 'status'],
    ['  /停止  ', 'stop'],
    ['/stop', 'stop'],
    ['/新会话', 'new'],
    ['/新建', 'new'],
    ['/new', 'new'],
    ['/帮助', 'help'],
    ['/help', 'help'],
  ])('%s → %s', (text, type) => {
    expect(parseRemoteCommand(text)).toEqual({ type })
  })

  it('takes only the first word after the slash', () => {
    expect(parseRemoteCommand('/停止 现在')).toEqual({ type: 'stop' })
  })

  it('reads bare digits (ASCII, full-width, trailing punctuation) as choices', () => {
    expect(parseRemoteCommand('1')).toEqual({ type: 'choice', n: 1 })
    expect(parseRemoteCommand(' ３ ')).toEqual({ type: 'choice', n: 3 })
    expect(parseRemoteCommand('2.')).toEqual({ type: 'choice', n: 2 })
    expect(parseRemoteCommand('2。')).toEqual({ type: 'choice', n: 2 })
  })

  it('keeps numbers that are not a single digit as messages', () => {
    expect(parseRemoteCommand('10')).toEqual({ type: 'message', text: '10' })
    expect(parseRemoteCommand('0')).toEqual({ type: 'message', text: '0' })
    expect(parseRemoteCommand('1 个问题')).toEqual({ type: 'message', text: '1 个问题' })
  })

  it('passes other slash text (a /技能 call included) through as a message', () => {
    expect(parseRemoteCommand('/模式 autopilot')).toEqual({ type: 'message', text: '/模式 autopilot' })
    expect(parseRemoteCommand('／周报 产品群')).toEqual({ type: 'message', text: '/周报 产品群' })
    expect(parseRemoteCommand('/')).toEqual({ type: 'message', text: '/' })
    const long = `/${'x'.repeat(40)}`
    expect(parseRemoteCommand(long)).toEqual({ type: 'message', text: long })
  })

  it('passes ordinary text through untouched', () => {
    expect(parseRemoteCommand(' 帮我看看今天谁找我 ')).toEqual({ type: 'message', text: '帮我看看今天谁找我' })
  })
})

describe('decisionForChoice', () => {
  it('maps the fixed numbering', () => {
    expect(decisionForChoice(1, true)).toBe('allow_once')
    expect(decisionForChoice(2, true)).toBe('allow_always')
    expect(decisionForChoice(3, true)).toBe('deny')
  })

  it('refuses "always" where the gate would not honour it', () => {
    expect(decisionForChoice(2, false)).toBe('unavailable')
    expect(decisionForChoice(1, false)).toBe('allow_once')
    expect(decisionForChoice(3, false)).toBe('deny')
  })

  it('is not a choice outside 1–3', () => {
    expect(decisionForChoice(4, true)).toBeUndefined()
    expect(decisionForChoice(9, false)).toBeUndefined()
  })
})
