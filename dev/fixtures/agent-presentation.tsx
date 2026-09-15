/** Isolated conversation presentation fixture; never reads real conversations or calls a model. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { CallId, TurnId } from '@aiwc/protocol'
import { Composer } from '@/features/agent/Composer'
import { MessageList } from '@/features/agent/MessageList'
import type { ThreadItem } from '@/features/agent/model'
import { setLanguage } from '@/i18n'
import '@/styles/tailwind.css'

const params = new URLSearchParams(location.search)
const isEnglish = params.get('lang') === 'en'
setLanguage(isEnglish ? 'en-US' : 'zh-CN')
document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark'
const turnId = 'preview-turn' as TurnId
const noop = () => {}

function Preview() {
  const [streaming, setStreaming] = useState(params.has('streaming'))
  const [draft, setDraft] = useState('')
  const items: ThreadItem[] = [
    {
      kind: 'user',
      id: 'user',
      turnId,
      content: [
        {
          type: 'text',
          text: isEnglish
            ? 'Summarize the project notes and verify the milestones.'
            : '帮我整理项目记录，并核对关键时间节点。',
        },
      ],
      mentions: [],
    },
    {
      kind: 'assistant',
      id: 'intro',
      turnId,
      text: isEnglish ? 'I will check the notes first, then assemble the timeline.' : '我先核对记录，再整理时间线。',
      streaming: false,
    },
    {
      kind: 'tools',
      id: 'tools',
      turnId,
      calls: [
        {
          callId: 'preview-call' as CallId,
          toolName: 'search',
          summary: isEnglish ? 'Search project notes' : '查找项目记录',
          status: 'done',
          risk: 'read',
          startedAt: 0,
          durationMs: 120,
          input: { query: 'project' },
          output: { count: 3 },
        },
      ],
    },
    {
      kind: 'assistant',
      id: 'answer',
      turnId,
      text: isEnglish
        ? 'The plan has three milestones:\n\n1. Confirm requirements.\n2. Review the prototype.\n3. Validate the release.'
        : '目前有三个关键节点：\n\n1. 确认需求范围。\n2. 评审交互原型。\n3. 验证发布结果。',
      streaming: false,
    },
    {
      kind: 'assistant',
      id: 'correction',
      turnId,
      text: streaming
        ? ''
        : isEnglish
          ? 'One correction: the review date is still tentative. Confirm it before scheduling the release.'
          : '补充更正：评审日期尚未最终确定，需要确认后再安排发布。',
      streaming,
      modelId: 'demo-model',
      durationMs: 12500,
    },
  ]
  return (
    <main className="mx-auto flex h-screen w-full max-w-sm flex-col border-x border-line-8 bg-panel text-fg">
      <div className="min-h-0 flex-1">
        <MessageList
          items={items}
          streaming={streaming}
          onEdit={setDraft}
          onResend={() => setStreaming(true)}
          onRegenerate={() => setStreaming(true)}
        />
      </div>
      <div className="p-3">
        <Composer
          value={draft}
          onValueChange={setDraft}
          mentions={[]}
          onMentionsChange={noop}
          onSubmit={() => setStreaming(true)}
          streaming={streaming}
          onStop={() => setStreaming(false)}
        />
      </div>
    </main>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<Preview />)
