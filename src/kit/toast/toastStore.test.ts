import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOAST_DEFAULT_DURATION, TOAST_MAX_VISIBLE, addToast, clearToasts, dismissToast, getToasts, subscribeToasts, toast, updateToast } from './toastStore'

beforeEach(() => {
  vi.useFakeTimers()
  clearToasts()
})

afterEach(() => {
  clearToasts()
  vi.useRealTimers()
})

describe('toastStore', () => {
  it('adds a toast and notifies subscribers', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToasts(listener)
    const id = addToast({ kind: 'success', text: '已保存' })
    expect(getToasts()).toHaveLength(1)
    expect(getToasts()[0]?.id).toBe(id)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('auto-dismisses after 4 s by default', () => {
    addToast({ kind: 'info', text: '提示' })
    vi.advanceTimersByTime(TOAST_DEFAULT_DURATION - 1)
    expect(getToasts()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(getToasts()).toHaveLength(0)
  })

  it('dismisses manually and clears the timer', () => {
    const listener = vi.fn()
    subscribeToasts(listener)
    const id = addToast({ kind: 'warning', text: '注意' })
    dismissToast(id)
    expect(getToasts()).toHaveLength(0)
    vi.advanceTimersByTime(TOAST_DEFAULT_DURATION * 2)
    // add + dismiss = 2 notifications, nothing more after the timer would have fired
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('keeps sticky toasts, toasts with an action and progress toasts until dismissed', () => {
    addToast({ kind: 'info', text: '常驻', sticky: true })
    addToast({ kind: 'info', text: '带操作', action: { label: '撤销', onClick: () => {} } })
    toast.progress('同步中')
    vi.advanceTimersByTime(TOAST_DEFAULT_DURATION * 5)
    expect(getToasts().map((t) => t.text)).toEqual(['常驻', '带操作', '同步中'])
    expect(getToasts().every((t) => t.sticky)).toBe(true)
  })

  it('lets an explicit sticky:false override the progress default', () => {
    addToast({ kind: 'progress', text: '短暂', sticky: false })
    vi.advanceTimersByTime(TOAST_DEFAULT_DURATION)
    expect(getToasts()).toHaveLength(0)
  })

  it('updates a toast in place and re-arms its timer', () => {
    const id = toast.progress('正在导出')
    vi.advanceTimersByTime(TOAST_DEFAULT_DURATION * 2)
    expect(getToasts()).toHaveLength(1)
    updateToast(id, { kind: 'success', text: '已导出', sticky: false })
    expect(getToasts()).toHaveLength(1)
    expect(getToasts()[0]?.kind).toBe('success')
    vi.advanceTimersByTime(TOAST_DEFAULT_DURATION)
    expect(getToasts()).toHaveLength(0)
  })

  it('caps the number of visible toasts', () => {
    for (let i = 0; i < TOAST_MAX_VISIBLE + 3; i++) addToast({ kind: 'info', text: `t${i}`, sticky: true })
    expect(getToasts()).toHaveLength(TOAST_MAX_VISIBLE)
    expect(getToasts()[0]?.text).toBe('t3')
  })
})
