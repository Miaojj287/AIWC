import { describe, expect, it } from 'vitest'
import { parseMacPsOutput, parseVersionString, parseWindowsTasklist } from './processDetect'

describe('parseWindowsTasklist', () => {
  it('parses CSV rows and sorts by working set', () => {
    const csv = [
      '"Weixin.exe","1234","Console","1","102,400 K"',
      '"Weixin.exe","5678","Console","1","512,000 K"',
      '"chrome.exe","9999","Console","1","10,000 K"',
    ].join('\n')
    const procs = parseWindowsTasklist(csv)
    expect(procs.map((p) => p.pid)).toEqual([5678, 1234])
    expect(procs[0]?.workingSetKb).toBe(512_000)
  })
})

describe('parseMacPsOutput', () => {
  it('keeps the main WeChat process and drops helpers', () => {
    const out = [
      '  PID COMM             COMMAND',
      '  100 WeChat           /Applications/WeChat.app/Contents/MacOS/WeChat',
      '  101 WeChatAppEx      /Applications/WeChat.app/Contents/.../WeChatAppEx',
      '  102 crashpad_handler /Applications/WeChat.app/.../crashpad_handler',
    ].join('\n')
    const procs = parseMacPsOutput(out)
    expect(procs.map((p) => p.pid)).toEqual([100])
  })
})

describe('parseVersionString', () => {
  it('extracts a dotted version', () => {
    expect(parseVersionString('CFBundleShortVersionString 4.0.6')).toBe('4.0.6')
    expect(parseVersionString('nope')).toBeUndefined()
  })
})
