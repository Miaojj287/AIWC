import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles/tailwind.css'
import { MessageRow } from '../../src/features/chat/MessageRow'
import type { WxMessage, WxRichContent } from '../../packages/protocol/src/substrate'
const cards: WxRichContent[] = [
  { type: 'article', title: '这波“闲事”，鹅管定了！', source: '腾讯游戏', description: '公众号文章摘要，点击整张卡片打开原文。', url: 'https://mp.weixin.qq.com/', coverUrl: `${location.origin}/wechat-emojis/face/微笑.png` },
  { type: 'link', title: '项目文档与工作安排', description: '普通链接保留标题、摘要和来源。', url: 'https://example.com/', source: '项目文档' },
  { type: 'miniProgram', title: '周末一起去打球', source: '活动报名' },
  { type: 'contact', title: '庄曼琦', description: '个人名片 · 深圳' },
  { type: 'location', title: '深圳湾公园', description: '广东省深圳市南山区', url: 'https://uri.amap.com/marker?position=114,22.5' },
  { type: 'transfer', title: '晚餐', amount: '¥88.00', status: '已收款' },
  { type: 'redPacket', title: '恭喜发财，大吉大利' },
  { type: 'announcement', title: '群公告', description: '本周活动改到周日下午三点，请大家准时到场。' },
  { type: 'chatHistory', title: '群聊的聊天记录', description: '小王：周末见\n小李：收到', entries: [{ title: '小王', description: '周末见' }, { title: '小李', description: '收到' }] },
]
const noop = () => {}
const msg = (id: number, text: string, kind: WxMessage['kind'], rich?: WxRichContent): WxMessage => ({ id: String(id), sessionId: 'demo', seq: id, createdAt: 1724660000000 + id * 60000, senderId: 'friend', senderName: '庄曼琦', isSelf: id === 1, kind, text, rich, anchor: { sessionId: 'demo', messageId: String(id), seq: id, createdAt: 1724660000000 } })
const messages = [msg(1, '你早点休息[微笑]', 'text'), msg(2, '我拍了拍 "庄曼琦" 说你好👋🏻', 'system'), msg(3, '你撤回了一条消息', 'revoke'), ...cards.map((r, i) => msg(i + 4, r.title, 'link', r))]
createRoot(document.getElementById('root')!).render(<main className="min-h-screen bg-content py-8 text-fg"><div className="mx-auto max-w-[760px]"><div className="mb-5 flex justify-between px-6"><h1>会话消息呈现回归预览</h1><button onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light' }}>切换明暗</button></div>{messages.map((message) => <MessageRow key={message.id} message={message} isGroup selectMode={false} selected={false} focused={false} continued={false} mac onCopy={noop} onQuote={noop} onToggleSelect={noop} onJumpToTime={noop} onDeleteLocal={noop} onOpenImage={noop} />)}</div></main>)
