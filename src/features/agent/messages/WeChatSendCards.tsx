/**
 * The WeChat send tools in the transcript: send_message, send_media, and draft_reply (which parks the text in the
 * reply desk instead of sending it). The approval and the expanded tool row render the same preview — who receives
 * it (avatar, name, 单聊 / 群聊, the raw id) and the bubbles exactly as the sender splits them — so what the user
 * approves and what the row reports afterwards never disagree. Sending cannot be undone: a missing or unknown
 * recipient is said out loud, never hidden behind JSON (CLAUDE.md §4.4, §6).
 */
import { Check, File as FileIcon, Image as ImageIcon, Mic, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isGroupChatId, splitOutboundBubbles, type SessionKind, type WxSession } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { localizeKnownText, useT, type MessageKey } from '@/i18n'
import { Avatar, Badge, Button, ICON_STROKE, InlineHint, Skeleton, type IconComponent } from '@/kit'
import { toMediaUrl } from '@/platform/mediaUrl'
import { safeJson } from '../ApprovalCard'
import { resolveSession } from '../citationResolver'
import type { ToolCallView } from '../model'
import { registerApprovalBody, registerToolCard, type ApprovalBodyProps, type ToolCardProps } from '../toolCards'

/** Tools that send, and so ask first. draft_reply sends nothing and never reaches the approval. */
const SEND_TOOLS = ['send_message', 'send_media'] as const
const DRAFT_TOOL = 'draft_reply'

const MEDIA_KINDS = ['image', 'file', 'voice'] as const
type MediaKind = (typeof MEDIA_KINDS)[number]

const MEDIA_ICON: Record<MediaKind, IconComponent> = { image: ImageIcon, file: FileIcon, voice: Mic }
const MEDIA_LABEL: Record<MediaKind, MessageKey> = {
  image: 'agent.wechatSend.media.image',
  file: 'agent.wechatSend.media.file',
  voice: 'agent.wechatSend.media.voice',
}
const KIND_LABEL: Record<SessionKind, MessageKey> = {
  dm: 'agent.mention.sessionKind.dm',
  group: 'agent.mention.sessionKind.group',
  official: 'agent.mention.sessionKind.official',
  system: 'agent.mention.sessionKind.system',
}

/** What the call puts into the chat, read from the same input fields the tool reads. */
interface Outgoing {
  to?: string
  media?: { kind: MediaKind; path: string }
  /** Text bubbles in send order: the message split on `---wx-next---`, or the media's caption. */
  bubbles: string[]
}

/** What the tool reported back (gateway deliver() / draft_reply), or the error text the kernel recorded. */
interface Outcome {
  ok?: boolean
  /** The chat it actually went to: a bot thread always answers its own chat, whatever `to` said. */
  to?: string
  /** Read back from the local chat history after sending. */
  verified: boolean
  error?: string
}

type Lookup =
  { status: 'loading' } | { status: 'found'; session: WxSession } | { status: 'missing' } | { status: 'error' }

const LOADING: Lookup = { status: 'loading' }

const record = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const nonEmpty = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)

function readOutgoing(toolName: string, input: unknown): Outgoing | undefined {
  const r = record(input)
  if (!r) return undefined
  const to = nonEmpty(r.to)
  if (toolName === 'send_media') {
    const kind = MEDIA_KINDS.find((k) => k === r.kind)
    const path = nonEmpty(r.path)
    if (!kind || !path) return undefined
    return { to, media: { kind, path }, bubbles: typeof r.caption === 'string' ? splitOutboundBubbles(r.caption) : [] }
  }
  return typeof r.text === 'string' ? { to, bubbles: splitOutboundBubbles(r.text) } : undefined
}

function readOutcome(output: ToolCallView['output']): Outcome {
  if (typeof output === 'string') return { verified: false, error: nonEmpty(output) }
  const r = record(output)
  return {
    ok: typeof r?.ok === 'boolean' ? r.ok : undefined,
    to: nonEmpty(r?.to),
    verified: r?.verified === true,
    error: nonEmpty(r?.error),
  }
}

/** The chat behind an id, through the citation cache; `loading` until it has answered for this very id. */
function useSessionLookup(id: string | undefined): Lookup {
  const [settled, setSettled] = useState<{ id: string; lookup: Lookup }>()
  useEffect(() => {
    if (!id) return
    let alive = true
    resolveSession(id).then(
      (session) => {
        if (alive) setSettled({ id, lookup: session ? { status: 'found', session } : { status: 'missing' } })
      },
      () => {
        if (alive) setSettled({ id, lookup: { status: 'error' } })
      },
    )
    return () => {
      alive = false
    }
  }, [id])
  return id && settled?.id === id ? settled.lookup : LOADING
}

/** The approval's preview (sends only: draft_reply never asks). */
export function WeChatSendApprovalBody({ request }: ApprovalBodyProps) {
  const outgoing = readOutgoing(request.toolName, request.input)
  if (!outgoing) return <RawInput value={request.input} />
  return (
    <div className="flex flex-col gap-2.5 rounded-item border border-line-6 bg-panel px-2.5 py-2">
      <Recipient id={outgoing.to} />
      <Contents outgoing={outgoing} countKey="agent.wechatSend.willSend" />
      {request.detail ? <div className="text-micro leading-4 text-fg-3">{request.detail}</div> : null}
    </div>
  )
}

/** The expanded tool row: the same preview, then what happened. */
export function WeChatSendCard({ call }: ToolCardProps) {
  const outgoing = readOutgoing(call.toolName, call.input)
  const outcome = readOutcome(call.output)
  const to = outcome.to ?? outgoing?.to
  return (
    <div className="flex flex-col gap-2.5 rounded-item border border-line-8 bg-panel px-3 py-2.5">
      {to || outgoing ? <Recipient id={to} /> : null}
      {outgoing ? (
        <Contents outgoing={outgoing} countKey="agent.wechatSend.count" />
      ) : call.input != null ? (
        <RawInput value={call.input} />
      ) : null}
      <Result call={call} outcome={outcome} />
    </div>
  )
}

/** Avatar, name (opens the chat), 单聊 / 群聊 and the raw id; a warning when the chat is missing or unknown. */
function Recipient({ id }: { id: string | undefined }) {
  const t = useT()
  const lookup = useSessionLookup(id)
  if (!id) {
    return (
      <InlineHint kind="warning" live={false}>
        {t('agent.wechatSend.noRecipient')}
      </InlineHint>
    )
  }
  const session = lookup.status === 'found' ? lookup.session : undefined
  const loading = lookup.status === 'loading'
  const name = session?.title?.trim() || id
  const kind: SessionKind = session?.kind ?? (isGroupChatId(id) ? 'group' : 'dm')
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {loading ? (
          <Skeleton className="size-7 shrink-0 rounded-item" />
        ) : (
          <Avatar id={id} name={name} src={toMediaUrl(session?.avatarPath)} size={28} />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-1.5">
            {loading ? (
              <Skeleton className="h-2.5 w-24 rounded-chip bg-line-10" />
            ) : session ? (
              <Button
                variant="link"
                size="sm"
                className="-ml-2.5 min-w-0 shrink text-body"
                onClick={() => runCommand('tab.openChat', { sessionId: id, title: name })}
              >
                <span className="min-w-0 truncate" title={name}>
                  {name}
                </span>
              </Button>
            ) : (
              <span className="min-w-0 truncate font-mono text-caption text-fg select-text" title={id}>
                {id}
              </span>
            )}
            <Badge tone={kind === 'group' ? 'info' : 'neutral'}>{t(KIND_LABEL[kind])}</Badge>
            {kind === 'group' && session?.memberCount ? (
              <span className="shrink-0 text-micro text-fg-3">
                {t('agent.wechatSend.members', { n: session.memberCount })}
              </span>
            ) : null}
          </div>
          {session || loading ? (
            <span className="min-w-0 truncate font-mono text-micro text-fg-3 select-text" title={id}>
              {id}
            </span>
          ) : null}
        </div>
      </div>
      {lookup.status === 'missing' || lookup.status === 'error' ? (
        <InlineHint kind="warning" live={false}>
          {t(lookup.status === 'missing' ? 'agent.wechatSend.notFound' : 'agent.wechatSend.lookupFailed')}
        </InlineHint>
      ) : null}
    </div>
  )
}

/** What lands in the chat, in order: the file, then the text bubbles as the contact will see them. */
function Contents({ outgoing, countKey }: { outgoing: Outgoing; countKey: MessageKey }) {
  const t = useT()
  const { media, bubbles } = outgoing
  const total = bubbles.length + (media ? 1 : 0)
  if (total === 0) {
    return (
      <InlineHint kind="warning" live={false}>
        {t('agent.wechatSend.noText')}
      </InlineHint>
    )
  }
  return (
    <div className="flex flex-col items-end gap-1">
      {total > 1 ? <span className="text-micro text-fg-3">{t(countKey, { n: total })}</span> : null}
      <ol
        aria-label={t('agent.wechatSend.content')}
        className="flex max-h-[200px] w-full flex-col items-end gap-1.5 overflow-y-auto"
      >
        {media ? (
          <li className="flex min-w-0 max-w-[85%] flex-col items-end gap-1.5">
            <MediaItem media={media} />
          </li>
        ) : null}
        {bubbles.map((bubble, i) => (
          <li
            key={i}
            className="max-w-[85%] whitespace-pre-wrap break-words rounded-window rounded-tr-sm bg-bubble-self px-3.5 py-2 text-bubble leading-bubble text-white select-text"
          >
            {bubble}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The file about to leave the machine: kind, name, full path; a thumbnail when it is an image the app can show. */
function MediaItem({ media }: { media: NonNullable<Outgoing['media']> }) {
  const t = useT()
  const [broken, setBroken] = useState(false)
  const Icon = MEDIA_ICON[media.kind]
  const name = media.path.split(/[\\/]/).pop() || media.path
  const thumb = media.kind === 'image' && !broken ? toMediaUrl(media.path) : undefined
  return (
    <>
      {thumb ? (
        <img
          src={thumb}
          alt={name}
          draggable={false}
          onError={() => setBroken(true)}
          className="max-h-40 max-w-full rounded-item border border-line-8 object-contain"
        />
      ) : null}
      <div className="flex w-full min-w-0 items-center gap-2.5 rounded-item border border-line-8 bg-content px-3 py-2">
        <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-2" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="min-w-0 truncate text-body text-fg select-text" title={name}>
            {name}
          </span>
          <span className="min-w-0 truncate font-mono text-micro text-fg-3 select-text" title={media.path}>
            {media.path}
          </span>
        </div>
        <Badge>{t(MEDIA_LABEL[media.kind])}</Badge>
      </div>
    </>
  )
}

/** The outcome under a finished call. A running row shimmers and an awaiting one says 等待确认 on its own line. */
function Result({ call, outcome }: { call: ToolCallView; outcome: Outcome }) {
  const t = useT()
  const draft = call.toolName === DRAFT_TOOL
  if (call.status === 'pending' || call.status === 'running' || call.status === 'awaiting_approval') return null
  if (call.status === 'denied') {
    return <span className="text-caption text-fg-3">{t('agent.wechatSend.status.denied')}</span>
  }
  if (call.status === 'timeout') {
    return (
      <InlineHint kind="warning" live={false}>
        {t('agent.wechatSend.status.timeout')}
      </InlineHint>
    )
  }
  if (call.status === 'error' || call.isError === true || outcome.ok === false) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <Badge tone="danger">
          {t(draft ? 'agent.wechatSend.status.draftFailed' : 'agent.wechatSend.status.failed')}
        </Badge>
        {outcome.error ? (
          <InlineHint kind="error" live={false}>
            {localizeKnownText(outcome.error)}
          </InlineHint>
        ) : null}
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge tone={draft ? 'accent' : 'ok'} icon={Check}>
        {t(draft ? 'agent.wechatSend.status.drafted' : 'agent.wechatSend.status.sent')}
      </Badge>
      {draft ? (
        <>
          <span className="text-caption text-fg-3">{t('agent.wechatSend.status.draftedHint')}</span>
          <Button variant="link" size="sm" onClick={() => runCommand('tab.openReplyDesk')}>
            {t('agent.wechatSend.openReplyDesk')}
          </Button>
        </>
      ) : outcome.verified ? (
        <span className="text-caption text-fg-3">{t('agent.wechatSend.status.verified')}</span>
      ) : null}
    </div>
  )
}

/** Input this preview cannot read (an older tool version): the raw payload rather than nothing. */
function RawInput({ value }: { value: unknown }) {
  return (
    <pre className="m-0 max-h-[132px] overflow-auto rounded-item border border-line-6 bg-panel px-2.5 py-2 font-mono text-micro leading-4 text-fg-3 select-text">
      {safeJson(value)}
    </pre>
  )
}

/** The approval preview for the two sends; the expanded-row card for all three (a draft is written: a pencil). */
export function registerWeChatSendCards(): () => void {
  const disposers = [
    ...SEND_TOOLS.map((name) => registerApprovalBody(name, WeChatSendApprovalBody)),
    ...SEND_TOOLS.map((name) => registerToolCard(name, WeChatSendCard, 'detail')),
    registerToolCard(DRAFT_TOOL, WeChatSendCard, 'detail', Pencil),
  ]
  return () => disposers.forEach((dispose) => dispose())
}
