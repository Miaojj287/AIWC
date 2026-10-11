import { describe, expect, it } from 'vitest'
import { isGroupChatId, splitOutboundBubbles } from './wechat'

describe('isGroupChatId', () => {
  it('knows WeChat and WeCom group ids, in any case', () => {
    expect(isGroupChatId('12345@chatroom')).toBe(true)
    expect(isGroupChatId('12345@im.chatroom')).toBe(true)
    expect(isGroupChatId(' 12345@ChatRoom ')).toBe(true)
  })

  it('treats everything else as a direct chat', () => {
    expect(isGroupChatId('wxid_abc')).toBe(false)
    expect(isGroupChatId('gh_official')).toBe(false)
    expect(isGroupChatId('chatroom')).toBe(false)
    expect(isGroupChatId('')).toBe(false)
  })
})

describe('splitOutboundBubbles', () => {
  it('splits on the marker on its own line and drops empty bubbles', () => {
    expect(splitOutboundBubbles('第一条\n---wx-next---\n第二条\n\n---wx-next---\n')).toEqual(['第一条', '第二条'])
    expect(splitOutboundBubbles('no separator')).toEqual(['no separator'])
  })

  it('also splits on an inline or mis-dashed marker, so it can never reach the contact', () => {
    expect(splitOutboundBubbles('想吃什么？ ---wx-next--- 先垫垫')).toEqual(['想吃什么？', '先垫垫'])
    expect(splitOutboundBubbles('第一条--wx-next--第二条')).toEqual(['第一条', '第二条'])
    expect(splitOutboundBubbles('---WX-NEXT---')).toEqual([])
    expect(splitOutboundBubbles('分割线 --- 后面')).toEqual(['分割线 --- 后面'])
  })
})
