import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIlinkSessionStore } from './sessionStore'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwc-ilink-session-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('ilink session store', () => {
  it('supports a process-only session without writing a login token', () => {
    const session = { token: 'token', baseUrl: 'https://example.com', botId: 'bot', userId: 'user' }
    const store = createIlinkSessionStore(dir, { persist: false })
    store.save(session, { getUpdatesBuf: 'cursor-1' })

    expect(store.load()).toMatchObject(session)
    expect(existsSync(store.path)).toBe(false)
    expect(createIlinkSessionStore(dir, { persist: false }).load()).toBeUndefined()
  })

  it('removes a login token persisted by an older build', () => {
    const session = { token: 'token', baseUrl: 'https://example.com', botId: 'bot', userId: 'user' }
    const oldStore = createIlinkSessionStore(dir)
    oldStore.save(session)
    expect(existsSync(oldStore.path)).toBe(true)

    const ephemeral = createIlinkSessionStore(dir, { persist: false })
    expect(ephemeral.load()).toBeUndefined()
    expect(existsSync(ephemeral.path)).toBe(false)
  })
})
