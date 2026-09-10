import { describe, expect, it } from 'vitest'
import { classifyWeChatWindows, type WindowInfo } from './macNative'

const window = (ownerPid: number, ownerName: string, title = '', width = 1000): WindowInfo => ({
  ownerPid, ownerName, title, bounds: { x: 0, y: 0, width, height: 700 }, area: width * 700,
})
const main = window(22, 'WeChat', '微信')

describe('WeChat keyboard focus', () => {
  it('does not mistake WeChat behind AIWC for the active app', () => {
    expect(classifyWeChatWindows([window(process.pid, 'AIWC'), main], process.pid).frontmost).toBe(false)
  })
  it('ignores an unrelated overlay or other-display window when WeChat owns keyboard focus', () => {
    expect(classifyWeChatWindows([window(33, 'Overlay'), main], 22).frontmost).toBe(true)
  })
  it('rejects a WeChat settings window above the main chat', () => {
    expect(classifyWeChatWindows([window(22, 'WeChat', '设置', 600), main], 22).frontmost).toBe(false)
  })
  it('fails closed when the active process cannot be queried', () => {
    expect(classifyWeChatWindows([main], 0).frontmost).toBe(false)
  })
  it('reports a missing visible window separately from a focus mismatch', () => {
    expect(classifyWeChatWindows([], 22)).toMatchObject({ found: false, frontmost: false })
  })
})
