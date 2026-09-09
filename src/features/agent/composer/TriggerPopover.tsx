/**
 * The `@` mention popover (会话 / 文件 / 联系人 / 记忆 segments, ↑↓ 选择 ↵ 插入 esc 关闭) and the `/`
 * skills popover (command + description). Both are controlled by the Composer, which owns the
 * keyboard; these components only render and report hover / click. Figma 150:619 / 150:674.
 */
import type { MentionKind, SkillSummary } from '@aiwc/protocol'
import { Avatar, EmptyState, Kbd, SegmentedControl } from '@/kit'
import { MENTION_TABS, type MentionCandidate } from '../mentionSources'
import { MENTION_ICON } from '../messages/mentionChips'

export interface MentionListProps {
  kind: MentionKind
  onKindChange: (kind: MentionKind) => void
  items: MentionCandidate[]
  loading?: boolean
  activeIndex: number
  onActiveIndexChange: (i: number) => void
  onPick: (item: MentionCandidate) => void
  query: string
}

export function MentionList({ kind, onKindChange, items, loading = false, activeIndex, onActiveIndexChange, onPick, query }: MentionListProps) {
  return (
    <div className="flex flex-col gap-2.5" data-popover="mention">
      <SegmentedControl aria-label="引用类型" size="sm" fullWidth options={MENTION_TABS} value={kind} onValueChange={onKindChange} />
      <div role="listbox" aria-label="引用候选" className="flex max-h-[176px] flex-col gap-px overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState variant={loading ? 'loading' : query ? 'no-results' : 'empty'} title={loading ? '正在搜索' : query ? '没有匹配项' : EMPTY_TITLE[kind]} compact className="py-3" />
        ) : (
          items.map((item, i) => {
            const Icon = MENTION_ICON[item.kind]
            return (
              <div
                key={`${item.kind}:${item.id}`}
                id={`mention-opt-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                data-highlighted={i === activeIndex || undefined}
                onMouseEnter={() => onActiveIndexChange(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(item)}
                className="flex h-[34px] shrink-0 cursor-default select-none items-center gap-2 rounded-control px-2 data-[highlighted]:bg-hover-7"
              >
                {item.kind === 'session' || item.kind === 'contact' ? (
                  <Avatar id={item.id} name={item.label} size={20} />
                ) : (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-control bg-line-8 text-fg-2">
                    <Icon size={12} strokeWidth={1.75} aria-hidden />
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-tab leading-4 text-fg">{item.label}</span>
                  {item.subtitle ? <span className="truncate text-micro leading-[14px] text-fg-3">{item.subtitle}</span> : null}
                </span>
              </div>
            )
          })
        )}
      </div>
      <KeyHints />
    </div>
  )
}

const EMPTY_TITLE: Record<MentionKind, string> = {
  session: '没有可引用的会话',
  file: '中间还没有打开文件',
  contact: '没有可引用的联系人',
  memory: '没有记忆文件',
}

export interface SkillListProps {
  items: SkillSummary[]
  activeIndex: number
  onActiveIndexChange: (i: number) => void
  onPick: (skill: SkillSummary) => void
}

export function SkillList({ items, activeIndex, onActiveIndexChange, onPick }: SkillListProps) {
  return (
    <div className="flex flex-col gap-1" data-popover="skills">
      <div className="px-2 pb-1 pt-0.5 text-micro font-medium text-fg-3">技能与指令 · 输入 / 触发</div>
      <div role="listbox" aria-label="技能" className="flex max-h-[220px] flex-col gap-px overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState variant="no-results" title="没有匹配的技能" compact className="py-3" />
        ) : (
          items.map((s, i) => (
            <div
              key={`${s.source}:${s.name}`}
              id={`skill-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              data-highlighted={i === activeIndex || undefined}
              onMouseEnter={() => onActiveIndexChange(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(s)}
              className="flex h-[42px] shrink-0 cursor-default select-none items-center gap-2.5 rounded-control px-2 data-[highlighted]:bg-hover-7"
            >
              <span className="w-10 shrink-0 truncate font-mono text-caption text-accent">{s.command}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-tab leading-4 text-fg">{s.name}</span>
                <span className="truncate text-micro leading-[14px] text-fg-3">{s.description}</span>
              </span>
              {s.source !== 'builtin' ? <span className="shrink-0 text-micro text-fg-3">{s.source === 'user' ? '自定义' : 'Agent'}</span> : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function KeyHints() {
  return (
    <div className="flex items-center gap-2.5 text-micro text-fg-3">
      <span className="flex items-center gap-1">
        <Kbd keys="↑↓" /> 选择
      </span>
      <span className="flex items-center gap-1">
        <Kbd keys="↵" /> 插入
      </span>
      <span className="flex items-center gap-1">
        <Kbd keys="esc" /> 关闭
      </span>
    </div>
  )
}
