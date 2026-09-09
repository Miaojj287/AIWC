// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AiwcBridge, EventMap } from '@aiwc/protocol'
import { __setBridgeForTests } from './bridge'
import { useBridgeEvent, useInvoke } from './hooks'

type Listener = (payload: unknown) => void

function fakeBridge() {
  const listeners = new Map<string, Set<Listener>>()
  let calls = 0
  const bridge: AiwcBridge & { emit(channel: string, payload: unknown): void; calls(): number } = {
    runtime: 'web',
    platform: 'darwin',
    calls: () => calls,
    emit(channel, payload) {
      for (const l of listeners.get(channel) ?? []) l(payload)
    },
    on: ((channel: string, listener: Listener) => {
      const set = listeners.get(channel) ?? new Set()
      set.add(listener)
      listeners.set(channel, set)
      return () => set.delete(listener)
    }) as AiwcBridge['on'],
    invoke: (async (channel: string, req: unknown) => {
      calls++
      if (channel === 'memory:read') {
        const { file } = req as { file: string }
        if (file === 'SOUL') throw new Error('boom')
        return `content of ${file} #${calls}`
      }
      throw new Error(`unexpected ${channel}`)
    }) as AiwcBridge['invoke'],
  }
  return bridge
}

describe('useInvoke', () => {
  let bridge: ReturnType<typeof fakeBridge>
  beforeEach(() => {
    bridge = fakeBridge()
    __setBridgeForTests(bridge)
  })
  afterEach(() => __setBridgeForTests(undefined))

  it('loads data and reloads on demand', async () => {
    const { result } = renderHook(() => useInvoke('memory:read', { file: 'MEMORY' }, []))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBe('content of MEMORY #1')
    expect(result.current.error).toBeUndefined()
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.data).toBe('content of MEMORY #2'))
  })

  it('re-runs when deps change and surfaces errors', async () => {
    const { result, rerender } = renderHook(({ file }: { file: 'MEMORY' | 'SOUL' }) => useInvoke('memory:read', { file }, [file]), { initialProps: { file: 'MEMORY' as 'MEMORY' | 'SOUL' } })
    await waitFor(() => expect(result.current.data).toBe('content of MEMORY #1'))
    rerender({ file: 'SOUL' })
    await waitFor(() => expect(result.current.error?.message).toBe('boom'))
    expect(result.current.loading).toBe(false)
  })

  it('does nothing while disabled', async () => {
    const { result } = renderHook(() => useInvoke('memory:read', { file: 'MEMORY' }, [], { enabled: false }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBeUndefined()
    expect(bridge.calls()).toBe(0)
  })
})

describe('useBridgeEvent', () => {
  it('subscribes for the component lifetime and always calls the latest handler', async () => {
    const bridge = fakeBridge()
    __setBridgeForTests(bridge)
    const seen: string[] = []
    const { rerender, unmount } = renderHook(({ tag }: { tag: string }) => useBridgeEvent('app:toast', (t) => seen.push(`${tag}:${t.text}`)), { initialProps: { tag: 'a' } })
    await waitFor(() => {
      bridge.emit('app:toast', { kind: 'info', text: 'one' } satisfies EventMap['app:toast'])
      expect(seen).toContain('a:one')
    })
    rerender({ tag: 'b' })
    bridge.emit('app:toast', { kind: 'info', text: 'two' } satisfies EventMap['app:toast'])
    expect(seen.at(-1)).toBe('b:two')
    unmount()
    bridge.emit('app:toast', { kind: 'info', text: 'three' } satisfies EventMap['app:toast'])
    expect(seen.some((s) => s.endsWith('three'))).toBe(false)
    __setBridgeForTests(undefined)
  })
})
