import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { TodoScanResult } from '@aiwc/protocol'
import { createTodoStore, type TodoScanner } from '@aiwc/memory'
import type { AppContext } from '../contracts'
import { unattendedScanToast } from '../composeTodo'
import type { HostBridge } from './register'
import { createHandlerHarness } from './testing/handlerHarness'
import { registerTodoIpc } from './todo'

function setup() {
  const store = createTodoStore({ dir: mkdtempSync(join(tmpdir(), 'aiwc-todo-ipc-')) })
  const scan = vi.fn<TodoScanner['scan']>(async () => result())
  const scanner = { scan, cancel: vi.fn(() => false), status: vi.fn() } as unknown as TodoScanner
  const broadcast = vi.fn()
  const ipc = createHandlerHarness()
  registerTodoIpc(
    { todo: { store, scanner, dispose: () => {} }, broadcast } as unknown as AppContext,
    {} as HostBridge,
    ipc.handle,
  )
  return { ipc, store, scan, broadcast }
}

const result = (over: Partial<TodoScanResult> = {}): TodoScanResult => ({
  ok: true,
  trigger: 'schedule',
  startedAt: 1,
  finishedAt: 2,
  scanned: 1,
  failed: 0,
  messages: 5,
  added: 2,
  ...over,
})

describe('todo IPC', () => {
  it('adds, updates and removes items, telling every window', async () => {
    const { ipc, broadcast } = setup()
    const item = await ipc.invoke('todo:add', { text: '  回复老板  ' })
    expect(item.text).toBe('回复老板')
    expect((await ipc.invoke('todo:update', { id: item.id, done: true })).done).toBe(true)
    expect((await ipc.invoke('todo:remove', { id: item.id }))?.id).toBe(item.id)
    expect(await ipc.invoke('todo:list', undefined)).toEqual([])
    expect(broadcast).toHaveBeenCalledWith('todo:changed', { scope: 'items' })
  })

  it('refuses malformed renderer input before it reaches disk', async () => {
    const { ipc, store } = setup()
    await expect(Promise.resolve().then(() => ipc.invokeRaw('todo:add', { text: '' }))).rejects.toThrow()
    await expect(Promise.resolve().then(() => ipc.invokeRaw('todo:add', { text: 'x'.repeat(500) }))).rejects.toThrow()
    await expect(
      Promise.resolve().then(() => ipc.invokeRaw('todo:update', { id: '../x', done: true })),
    ).rejects.toThrow()
    await expect(
      Promise.resolve().then(() => ipc.invokeRaw('todo:update', { id: 'abc', done: 'yes' })),
    ).rejects.toThrow()
    await expect(Promise.resolve().then(() => ipc.invokeRaw('todo:day', { date: '../../etc' }))).rejects.toThrow()
    await expect(
      Promise.resolve().then(() => ipc.invokeRaw('todo:restore', { item: { id: 'a', text: 1 } })),
    ).rejects.toThrow()
    await expect(Promise.resolve().then(() => ipc.invokeRaw('todo:scan', { sourceIds: 'all' }))).rejects.toThrow()
    expect(await store.list()).toEqual([])
  })

  it('reports an item deleted elsewhere as a sentence, not a stack', async () => {
    const { ipc } = setup()
    await expect(Promise.resolve().then(() => ipc.invoke('todo:update', { id: 'gone', done: true }))).rejects.toThrow(
      '这条待办已不存在',
    )
  })

  it('starts manual scans for the given chats only', async () => {
    const { ipc, scan } = setup()
    await ipc.invoke('todo:scan', { sourceIds: ['g1@chatroom'] })
    expect(scan).toHaveBeenCalledWith({ trigger: 'manual', sourceIds: ['g1@chatroom'] })
  })
})

describe('unattendedScanToast', () => {
  it('stays quiet for manual scans and for scheduled scans that found nothing', () => {
    expect(unattendedScanToast(result({ trigger: 'manual' }), undefined)).toBeUndefined()
    expect(unattendedScanToast(result({ added: 0 }), undefined)).toBeUndefined()
  })

  it('announces new to-dos with a way to view them', () => {
    expect(unattendedScanToast(result(), undefined)).toMatchObject({
      kind: 'success',
      text: '每日待办：新增 2 条',
      action: { command: 'tab.openTodo' },
    })
  })

  it('reports a failure once, not on every scan of a failing streak', () => {
    const failed = result({ ok: false, failure: 'model_unavailable', added: 0 })
    expect(unattendedScanToast(failed, result())).toMatchObject({
      kind: 'error',
      action: { command: 'tab.openSettings', payload: { page: 'todo' } },
    })
    expect(unattendedScanToast(failed, failed)).toBeUndefined()
    expect(unattendedScanToast(result({ ok: false, failure: 'cancelled' }), undefined)).toBeUndefined()
  })
})
