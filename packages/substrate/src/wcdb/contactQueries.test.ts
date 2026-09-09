import { describe, expect, it, vi } from 'vitest'
import { ContactDirectory } from './contactQueries'
import type { WcdbQuery } from './query'

describe('local avatar fallback', () => {
  it('loads and caches head_image blobs even for contacts absent from contact.db', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const get = vi.fn(() => ({ image_buffer: bytes }))
    const q = { get } as unknown as WcdbQuery
    const contacts = new ContactDirectory(q, null, '/head_image.db')
    expect(contacts.avatar('group@chatroom')).toBe(`data:image/png;base64,${bytes.toString('base64')}`)
    contacts.avatar('group@chatroom')
    expect(get).toHaveBeenCalledTimes(1)
    contacts.invalidate()
    contacts.avatar('group@chatroom')
    expect(get).toHaveBeenCalledTimes(2)
  })
  it('tolerates unavailable optional databases', () => {
    const q = { get: () => { throw new Error('unavailable') } } as unknown as WcdbQuery
    expect(new ContactDirectory(q, null, '/head.db').avatar('x')).toBeUndefined()
  })
})
