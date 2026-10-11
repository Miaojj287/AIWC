import { expect, it, vi } from 'vitest'
import { createAccountRuntime } from './accountRuntime'

it('keeps reminders and outbound automation dormant until entry, and starts each only once', () => {
  const tasks = vi.fn()
  const replies = vi.fn()
  const activate = createAccountRuntime([tasks, replies])
  expect(tasks).not.toHaveBeenCalled()
  expect(replies).not.toHaveBeenCalled()
  activate()
  activate()
  expect(tasks).toHaveBeenCalledOnce()
  expect(replies).toHaveBeenCalledOnce()
})
