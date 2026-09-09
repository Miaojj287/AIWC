// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog, DangerDialog } from './DialogVariants'
import { Drawer } from './Drawer'

afterEach(cleanup)

// Radix attaches its outside-pointer listener on the next tick after mount.
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)))

const overlay = () => document.querySelector('.kit-overlay') as HTMLElement

describe('DangerDialog', () => {
  it('does not close when the scrim is clicked', async () => {
    const onOpenChange = vi.fn()
    render(<DangerDialog open onOpenChange={onOpenChange} title="删除会话？" description="不可撤销" onConfirm={() => {}} />)
    await settle()
    const scrim = overlay()
    expect(scrim).not.toBeNull()
    fireEvent.pointerDown(scrim, { button: 0 })
    fireEvent.pointerUp(scrim, { button: 0 })
    fireEvent.click(scrim, { button: 0 })
    await settle()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('focuses 取消 by default and uses a danger primary', async () => {
    render(<DangerDialog open onOpenChange={() => {}} title="删除会话？" onConfirm={() => {}} />)
    await settle()
    const cancel = screen.getByRole('button', { name: '取消' })
    expect(document.activeElement).toBe(cancel)
    expect(screen.getByRole('button', { name: '删除' }).className).toContain('bg-danger')
  })

  it('gates the danger button behind the confirm word', async () => {
    const onConfirm = vi.fn()
    render(<DangerDialog open onOpenChange={() => {}} title="清空记忆？" onConfirm={onConfirm} confirmLabel="清空" confirmWord="清空" />)
    await settle()
    const confirm = screen.getByRole('button', { name: '清空' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('确认词'), { target: { value: '清空' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('confirm guard', () => {
  it('runs a pending confirm handler only once, however often it is clicked', async () => {
    let resolve = () => {}
    const onConfirm = vi.fn(() => new Promise<void>((r) => { resolve = r }))
    render(<DangerDialog open onOpenChange={() => {}} title="删除规则？" onConfirm={onConfirm} />)
    await settle()
    const confirm = screen.getByRole('button', { name: '删除' }) as HTMLButtonElement
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    // …and the wait is visible: both buttons go busy until the promise settles.
    expect(confirm.getAttribute('aria-busy')).toBe('true')
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { resolve() })
    expect(confirm.getAttribute('aria-busy')).toBeNull()
  })

  it('leaves synchronous handlers alone (the caller owns closing the dialog)', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog open onOpenChange={() => {}} title="放弃修改？" confirmLabel="放弃修改" onConfirm={onConfirm} />)
    await settle()
    const confirm = screen.getByRole('button', { name: '放弃修改' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })
})

describe('ConfirmDialog', () => {
  it('closes when the scrim is clicked', async () => {
    const onOpenChange = vi.fn()
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="确认操作？" onConfirm={() => {}} />)
    await settle()
    const scrim = overlay()
    fireEvent.pointerDown(scrim, { button: 0 })
    await settle()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('calls onConfirm from the primary button', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog open onOpenChange={() => {}} title="确认操作？" onConfirm={onConfirm} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('scrim', () => {
  it('is one shared overlay class for Dialog and Drawer, with no per-component opacity', async () => {
    render(<ConfirmDialog open onOpenChange={() => {}} title="确认操作？" onConfirm={() => {}} />)
    await settle()
    const dialogScrim = overlay().className
    cleanup()
    render(
      <Drawer open onOpenChange={() => {}} title="抽屉">
        内容
      </Drawer>,
    )
    await settle()
    const drawerScrim = overlay().className
    expect(drawerScrim).toBe(dialogScrim)
    expect(dialogScrim).toContain('kit-overlay')
    expect(dialogScrim).not.toMatch(/bg-black|bg-white|\/\d+/)
  })
})
