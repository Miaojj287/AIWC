/**
 * Isolated conversation presentation fixture; never reads real conversations or calls a model.
 * Query parameters: `lang=en`, `theme=light`, `streaming` (the last turn is still running), `approval` (a request
 * waits in the composer slot), `empty` (an empty thread: the composer alone), `wide` (Agent-window width: navigator rail).
 */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ApprovalId, CallId, TurnId } from '@aiwc/protocol'
import { ApprovalCard } from '@/features/agent/ApprovalCard'
import { Composer } from '@/features/agent/Composer'
import { MessageList } from '@/features/agent/MessageList'
import type { ApprovalRequest, ThreadItem } from '@/features/agent/model'
import { setLanguage } from '@/i18n'
import { cn } from '@/kit'
import '@/styles/tailwind.css'

const params = new URLSearchParams(location.search)
const isEnglish = params.get('lang') === 'en'
setLanguage(isEnglish ? 'en-US' : 'zh-CN')
document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark'
const wide = params.has('wide')
const firstTurn = 'preview-turn-1' as TurnId
const turnId = 'preview-turn-2' as TurnId
const noop = () => {}
const pick = (en: string, zh: string) => (isEnglish ? en : zh)
// Fixed offsets from page load, so the headers show real durations.
const t0 = Date.now() - 9 * 60_000

const approvalRequest: ApprovalRequest = {
  approvalId: 'preview-approval' as ApprovalId,
  callId: 'preview-send' as CallId,
  turnId,
  toolName: 'send_message',
  summary: pick('Send the timeline to the project group', '把时间线发到项目群'),
  detail: pick('Timeline draft · 3 milestones', '时间线草稿 · 3 个节点'),
  input: { to: 'project-group' },
  risk: 'send',
  canAllowAlways: true,
}

function Preview() {
  const [streaming, setStreaming] = useState(params.has('streaming') || params.has('approval'))
  const [approval, setApproval] = useState(params.has('approval'))
  const [draft, setDraft] = useState('')
  const empty = params.has('empty')
  const running = streaming
  const items: ThreadItem[] = empty
    ? []
    : [
        {
          kind: 'user',
          id: 'user-1',
          turnId: firstTurn,
          createdAt: t0,
          content: [{ type: 'text', text: pick('Which chats mention the release?', '哪些会话提到了发布？') }],
          mentions: [],
        },
        {
          kind: 'tools',
          id: 'tools-1',
          turnId: firstTurn,
          calls: ['A', 'B', 'C'].map((n, i) => ({
            callId: `preview-read-${n}` as CallId,
            toolName: 'search',
            summary: pick(`Search chat ${n}`, `检索会话 ${n}`),
            status: 'done' as const,
            risk: 'read' as const,
            startedAt: t0 + 1000 + i * 900,
            durationMs: 800,
            input: { query: 'release', chat: n },
            output: { count: i + 1 },
          })),
        },
        {
          kind: 'assistant',
          id: 'answer-1',
          turnId: firstTurn,
          text: pick(
            'Three chats mention the release; the project group has the latest date.',
            '有三个会话提到了发布，项目群里的日期最新。',
          ),
          streaming: false,
          modelId: 'demo-model',
          createdAt: t0 + 5000,
        },
        {
          kind: 'user',
          id: 'user-2',
          turnId,
          createdAt: t0 + 60_000,
          content: [
            {
              type: 'text',
              text: pick(
                'Summarize the project notes and verify the milestones.',
                '帮我整理项目记录，并核对关键时间节点。',
              ),
            },
          ],
          mentions: [],
        },
        {
          kind: 'assistant',
          id: 'intro',
          turnId,
          reasoning: pick(
            'Check the source dates before organizing the milestones.',
            '先核对记录中的日期，再整理里程碑，避免把尚未确认的安排当成已确定的时间。',
          ),
          text: pick('I will check the notes first, then assemble the timeline.', '我先核对记录，再整理时间线。'),
          streaming: false,
          startedAt: t0 + 61_000,
          durationMs: 3000,
        },
        {
          kind: 'tools',
          id: 'tools-2',
          turnId,
          calls: [
            {
              callId: 'preview-call' as CallId,
              toolName: 'search',
              summary: pick('Search project notes', '查找项目记录'),
              status: 'done',
              risk: 'read',
              startedAt: t0 + 65_000,
              durationMs: 1200,
              input: { query: 'project' },
              output: { count: 3 },
            },
            {
              callId: 'preview-write' as CallId,
              toolName: 'memory_write',
              summary: pick('Save the milestone list to memory', '把里程碑写入记忆'),
              status: running ? (approval ? 'awaiting_approval' : 'running') : 'done',
              risk: 'write',
              startedAt: t0 + 67_000,
              durationMs: running ? undefined : 400,
              input: { file: 'memory' },
            },
          ],
        },
        ...(running
          ? []
          : ([
              {
                kind: 'plan',
                id: 'plan',
                turnId,
                steps: [
                  { title: pick('Confirm requirements', '确认需求范围'), status: 'done' },
                  { title: pick('Review the prototype', '评审交互原型'), status: 'done' },
                  { title: pick('Validate the release', '验证发布结果'), status: 'doing' },
                ],
              },
              {
                kind: 'assistant',
                id: 'answer',
                turnId,
                text: pick(
                  'The plan has three milestones:\n\n1. Confirm requirements.\n2. Review the prototype.\n3. Validate the release.\n\nOne correction: the review date is still tentative.',
                  '目前有三个关键节点：\n\n1. 确认需求范围。\n2. 评审交互原型。\n3. 验证发布结果。\n\n补充更正：评审日期尚未最终确定，需要确认后再安排发布。',
                ),
                streaming: false,
                modelId: 'demo-model',
                startedAt: t0 + 70_000,
                durationMs: 12_500,
              },
            ] satisfies ThreadItem[])),
        ...(running && !approval
          ? [
              {
                kind: 'assistant' as const,
                id: 'thinking',
                turnId,
                reasoning: pick(
                  'Verify whether the review date has been confirmed.\nCompare it with the release checklist.',
                  '正在核对评审日期是否已经确认。\n再和发布清单对照一遍。',
                ),
                text: '',
                streaming: true,
              },
            ]
          : []),
      ]
  const composer = (
    <Composer
      value={draft}
      onValueChange={setDraft}
      mentions={[]}
      onMentionsChange={noop}
      onSubmit={() => setStreaming(true)}
      streaming={streaming}
      onStop={() => setStreaming(false)}
      history={[pick('Which chats mention the release?', '哪些会话提到了发布？')]}
    />
  )
  return (
    <main
      className={cn(
        'mx-auto flex h-screen w-full flex-col border-x border-line-8 bg-panel text-fg',
        wide ? 'max-w-5xl' : 'max-w-sm',
      )}
    >
      {empty ? (
        <>
          <div className="min-h-0 flex-1" />
          <div className="p-3">{composer}</div>
          <div className="min-h-0 flex-[1.4]" />
        </>
      ) : (
        <>
          <div className="min-h-0 flex-1">
            <MessageList
              items={items}
              streaming={streaming}
              turnStartedAt={t0 + 60_000}
              pendingApprovals={approval ? [approvalRequest] : []}
              onEdit={setDraft}
              onResend={() => setStreaming(true)}
              onRegenerate={() => setStreaming(true)}
              onFeedback={noop}
              contentClassName={wide ? 'mx-auto w-full max-w-[760px]' : undefined}
            />
          </div>
          <div className={cn('p-3', wide && 'mx-auto w-full max-w-[784px]')}>
            {approval ? (
              <ApprovalCard
                request={approvalRequest}
                onResolve={() => {
                  setApproval(false)
                  setStreaming(false)
                }}
              />
            ) : null}
            <div hidden={approval}>{composer}</div>
          </div>
        </>
      )}
    </main>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<Preview />)
