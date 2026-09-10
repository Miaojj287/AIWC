import { describe, expect, it, vi } from 'vitest'
import { activateWeChatWindow, createDarwinInjector } from './darwin'
import { InjectorError } from './types'

/**
 * The CoreGraphics path cannot run under vitest, so these cover the osascript fallback and the
 * order of operations both paths share. `native: false` forces the fallback explicitly rather than
 * depending on whether the test machine happens to have koffi.
 */
function setup(frontmost: string[] = ['WeChat']) {
  const scripts: string[] = []
  const clipboard: string[] = []
  let front = 0
  const run = vi.fn(async (script: string) => {
    scripts.push(script)
    if (script.includes('frontmost is true')) return frontmost[Math.min(front++, frontmost.length - 1)] ?? ''
    return ''
  })
  const injector = createDarwinInjector({ run, setClipboard: async (t) => void clipboard.push(t), sleep: async () => {}, launch: async () => {}, native: false })
  return { injector, scripts, clipboard, run }
}

const keystrokes = (scripts: string[]) => scripts.filter((s) => s.includes('keystroke') || s.includes('key code'))

describe('darwin injector', () => {
  it('skips activation when WeChat is already frontmost, then searches and opens the chat', async () => {
    const h = setup()
    await h.injector.focusSession('小明')
    expect(h.scripts.some((s) => s.includes('activate'))).toBe(false)
    expect(h.clipboard).toEqual(['小明'])
    // Cmd+F, Cmd+V, Return — the search jump, in that order
    expect(keystrokes(h.scripts)).toEqual([
      'tell application "System Events" to keystroke "f" using {command down}',
      'tell application "System Events" to keystroke "v" using {command down}',
      'tell application "System Events" to key code 36',
    ])
  })

  it('waits for delayed activation without launching again', async () => {
    const launch = vi.fn(async () => {})
    let probes = 0
    await activateWeChatWindow({ native: true, trusted: () => true, launch, sleep: async () => {},
      probeWindow: () => ({ found: probes >= 3, frontmost: ++probes >= 4 }),
    })
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it('tries Apple Events when open returns successfully without bringing WeChat forward', async () => {
    const h = setup(['Finder', ...Array(10).fill('Finder'), 'WeChat'])
    await h.injector.focusSession('小明')
    expect(h.scripts.filter((s) => s.includes('activate'))).toHaveLength(1)
  })

  it('stops before search paste when focus is lost during the wait', async () => {
    const h = setup(['WeChat', 'WeChat', 'Safari'])
    await expect(h.injector.focusSession('小明')).rejects.toMatchObject({ reason: 'focus-failed' })
    expect(keystrokes(h.scripts)).toHaveLength(1)
    expect(keystrokes(h.scripts)[0]).toContain('keystroke "f"')
  })

  it('does not paste after the clipboard operation changes focus', async () => {
    const h = setup(['WeChat', 'Safari'])
    await expect(h.injector.fill('测试')).rejects.toMatchObject({ reason: 'focus-failed' })
    expect(keystrokes(h.scripts)).toHaveLength(0)
  })

  it('fails with focus-failed when no activation script brings WeChat forward', async () => {
    const h = setup(['Finder'])
    await expect(h.injector.focusSession('小明')).rejects.toBeInstanceOf(InjectorError)
    await expect(h.injector.focusSession('小明')).rejects.toMatchObject({ reason: 'focus-failed' })
  })

  it('pastes without sending, and commits with exactly one Return', async () => {
    const h = setup()
    await h.injector.fill('晚点回你')
    expect(h.clipboard).toEqual(['晚点回你'])
    expect(keystrokes(h.scripts)).toEqual(['tell application "System Events" to keystroke "v" using {command down}'])
    await h.injector.commit()
    expect(keystrokes(h.scripts).filter((s) => s.includes('key code 36'))).toHaveLength(1)
  })

  it('never types or commits into a window that is no longer WeChat', async () => {
    const h = setup(['Safari'])
    await expect(h.injector.fill('晚点回你')).rejects.toMatchObject({ reason: 'focus-failed' })
    await expect(h.injector.commit()).rejects.toMatchObject({ reason: 'focus-failed' })
    expect(h.clipboard).toEqual([])
    expect(keystrokes(h.scripts)).toEqual([])
  })

  it("reports the assistive-access denial as 'no-permission' instead of a raw osascript error", async () => {
    const run = vi.fn(async () => {
      throw new InjectorError('no-permission', 'osascript is not allowed assistive access')
    })
    const injector = createDarwinInjector({ run, setClipboard: async () => {}, sleep: async () => {}, launch: async () => {}, native: false })
    await expect(injector.commit()).rejects.toMatchObject({ reason: 'no-permission' })
  })
})
