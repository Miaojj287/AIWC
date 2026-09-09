import { describe, expect, it, vi } from 'vitest'
import { createBackgroundAxInjector, type AxProfile } from './backgroundAx'

const selector = (id: string) => ({ role: 'AXGroup', identifier: id })
const profile: AxProfile = {
  wechatVersion: 'test', conversationList: selector('list'), conversationRow: selector('row'),
  header: selector('header'), composer: selector('composer'), sendButton: selector('send'),
}

describe('background AX injector', () => {
  it('requires a successful selection and fill before committing', async () => {
    const run = vi.fn(async () => ({ ok: true }))
    const injector = createBackgroundAxInjector({ profile, run })
    await expect(injector.commit()).rejects.toThrow('未确认')
    await expect(injector.fill('hello')).rejects.toThrow('未确认')
    expect(run).not.toHaveBeenCalled()
    await injector.focusSession('Alice')
    await injector.fill('你好\n世界')
    await injector.commit()
    expect(run.mock.calls).toEqual([
      [{ action: 'select', name: 'Alice', text: undefined, profile }],
      [{ action: 'fill', name: 'Alice', text: '你好\n世界', profile }],
      [{ action: 'commit', name: 'Alice', text: '你好\n世界', profile }],
    ])
    expect(injector.retryCommit).toBe(false)
  })

  it('fails closed without a verified profile', async () => {
    const run = vi.fn()
    const injector = createBackgroundAxInjector({ run })
    await expect(injector.focusSession('Alice')).rejects.toThrow('尚未配置')
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects missing identifiers and missing version', async () => {
    for (const bad of [{ ...profile, wechatVersion: '' }, { ...profile, composer: selector('') }]) {
      const run = vi.fn()
      await expect(createBackgroundAxInjector({ profile: bad, run }).focusSession('Alice')).rejects.toThrow('配置')
      expect(run).not.toHaveBeenCalled()
    }
  })

  it('only permits a busy retry before a write has started', async () => {
    const run = vi.fn().mockResolvedValueOnce({ ok: false, reason: 'busy' })
      .mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, reason: 'busy', detail: 'foreground changed' })
    const injector = createBackgroundAxInjector({ profile, run })
    await expect(injector.focusSession('Alice')).rejects.toMatchObject({ reason: 'busy' })
    await injector.focusSession('Alice')
    await expect(injector.fill('draft')).rejects.toMatchObject({ reason: 'unsupported' })
    await expect(injector.commit()).rejects.toThrow('未确认')
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('invalidates old target after failed selection and old text after failed fill', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true })
    const injector = createBackgroundAxInjector({ profile, run })
    await injector.focusSession('Alice')
    await injector.fill('old')
    run.mockResolvedValueOnce({ ok: false, reason: 'unsupported' })
    await expect(injector.focusSession('Bob')).rejects.toThrow()
    await expect(injector.commit()).rejects.toThrow('未确认')
    await expect(injector.fill('new')).rejects.toThrow('未确认')
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('reports a missing helper without invoking the foreground injector', async () => {
    const injector = createBackgroundAxInjector({ profile })
    await expect(injector.focusSession('Alice')).rejects.toThrow('未配置后台回复辅助程序')
  })
})
