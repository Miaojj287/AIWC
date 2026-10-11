import { expect, it, vi } from 'vitest'
import { showNativeNotification } from './nativeNotification'

const notification = vi.hoisted(() => ({ on: vi.fn(), show: vi.fn() }))
const construct = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null },
  Notification: class {
    constructor(options: unknown) {
      construct(options)
    }
    on = notification.on
    show = notification.show
  },
}))
it('passes the product artwork to native notifications and retains their actions', () => {
  const onClick = vi.fn()
  const onClose = vi.fn()
  showNativeNotification({ title: 'Reminder', body: 'Example', onClick, onClose }, '/app/app-icon.png')
  expect(construct).toHaveBeenCalledWith({ title: 'Reminder', body: 'Example', icon: '/app/app-icon.png' })
  expect(notification.on).toHaveBeenCalledWith('click', onClick)
  expect(notification.on).toHaveBeenCalledWith('close', onClose)
  expect(notification.show).toHaveBeenCalledOnce()
})
