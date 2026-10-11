/**
 * The `@` mention popover (会话 / 文件 / 联系人 / 记忆 segments, ↑↓ 选择 ↵ 插入 esc 关闭) and the `/`
 * skills popover (command + description). Both are controlled by the Composer, which owns the
 * keyboard; these components only render and report hover / click. Figma 150:619 / 150:674.
 *
 * The Composer's textarea is the combobox: `listboxId` is what its `aria-controls` points at, and
 * `optionId(listboxId, i)` what `aria-activedescendant` names. Rows are kit menu items (h30, h42 with a second line).
 */
import type { ReactNode } from 'react'
import type { MentionKind, SkillSummary } from '@aiwc/protocol'
import { useT, type MessageKey } from '@/i18n'
import { Avatar, EmptyState, ICON_STROKE, Kbd, menuItemClass, SegmentedControl } from '@/kit'
import { MENTION_TABS, type MentionCandidate } from '../mentionSources'
import { MENTION_ICON } from '../messages/mentionChips'
import { isLocalCommandItem } from '../slashCommands'

/** DOM id of option `index` in the listbox `listboxId`. */
export const optionId = (listboxId: string, index: number): string => `${listboxId}-opt-${index}`

/** Label + optional second line, laid out like the kit's MenuItemContent (the leading slot differs per list). */
function OptionText({ label, description }: { label: string; description?: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-px">
      <span className="truncate leading-4" title={label}>
        {label}
      </span>
      {description ? (
        <span className="truncate text-micro leading-4 text-fg-3" title={description}>
          {description}
        </span>
      ) : null}
    </span>
  )
}

/**
 * What the list currently holds, for assistive tech: the number of options, that a search is running, or that
 * nothing matched. Polite, so it never interrupts typing. The empty / loading template is visible; the count is not.
 */
function ListFeedback({ count, children }: { count: number; children: ReactNode }) {
  const t = useT()
  return (
    <div aria-live="polite">
      {count > 0 ? <span className="sr-only">{t('agent.composer.suggestionCount', { n: count })}</span> : children}
    </div>
  )
}

export interface MentionListProps {
  /** Id of the listbox element (the combobox's `aria-controls`). */
  listboxId: string
  kind: MentionKind
  onKindChange: (kind: MentionKind) => void
  items: MentionCandidate[]
  loading?: boolean
  activeIndex: number
  onActiveIndexChange: (i: number) => void
  onPick: (item: MentionCandidate) => void
  query: string
}

export function MentionList({
  listboxId,
  kind,
  onKindChange,
  items,
  loading = false,
  activeIndex,
  onActiveIndexChange,
  onPick,
  query,
}: MentionListProps) {
  const t = useT()
  return (
    <div className="flex flex-col gap-2.5" data-popover="mention">
      <SegmentedControl
        aria-label={t('agent.mention.typeLabel')}
        size="sm"
        fullWidth
        options={MENTION_TABS.map((tab) => ({ value: tab.value, label: t(tab.labelKey) }))}
        value={kind}
        onValueChange={onKindChange}
      />
      <div className="flex max-h-[192px] flex-col overflow-y-auto">
        <div id={listboxId} role="listbox" aria-label={t('agent.mention.candidates')} className="flex flex-col gap-px">
          {items.map((item, i) => {
            const Icon = MENTION_ICON[item.kind]
            return (
              <div
                key={`${item.kind}:${item.id}`}
                id={optionId(listboxId, i)}
                role="option"
                aria-selected={i === activeIndex}
                data-highlighted={i === activeIndex || undefined}
                onMouseEnter={() => onActiveIndexChange(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(item)}
                className={menuItemClass({ description: Boolean(item.subtitle) })}
              >
                {item.kind === 'session' || item.kind === 'contact' ? (
                  <Avatar id={item.id} name={item.label} size={20} />
                ) : (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-control bg-line-8 text-fg-2">
                    <Icon size={12} strokeWidth={ICON_STROKE} aria-hidden />
                  </span>
                )}
                <OptionText label={item.label} description={item.subtitle} />
              </div>
            )
          })}
        </div>
        <ListFeedback count={items.length}>
          <EmptyState
            variant={loading ? 'loading' : query ? 'no-results' : 'empty'}
            title={loading ? t('agent.mention.searching') : query ? t('agent.mention.noMatches') : t(EMPTY_TITLE[kind])}
            compact
            className="py-3"
          />
        </ListFeedback>
      </div>
      <KeyHints />
    </div>
  )
}

const EMPTY_TITLE: Record<MentionKind, MessageKey> = {
  session: 'agent.mention.empty.session',
  file: 'agent.mention.empty.file',
  contact: 'agent.mention.empty.contact',
  memory: 'agent.mention.empty.memory',
}

export interface SkillListProps {
  /** Id of the listbox element (the combobox's `aria-controls`). */
  listboxId: string
  items: SkillSummary[]
  activeIndex: number
  onActiveIndexChange: (i: number) => void
  onPick: (skill: SkillSummary) => void
}

export function SkillList({ listboxId, items, activeIndex, onActiveIndexChange, onPick }: SkillListProps) {
  const t = useT()
  return (
    <div className="flex flex-col gap-1" data-popover="skills">
      <div className="px-2 pb-1 pt-0.5 text-micro font-medium text-fg-3">{t('agent.skills.header')}</div>
      <div className="flex max-h-[220px] flex-col overflow-y-auto">
        <div id={listboxId} role="listbox" aria-label={t('agent.skills.label')} className="flex flex-col gap-px">
          {items.map((s, i) => (
            <div
              key={`${s.source}:${s.name}`}
              id={optionId(listboxId, i)}
              role="option"
              aria-selected={i === activeIndex}
              data-highlighted={i === activeIndex || undefined}
              onMouseEnter={() => onActiveIndexChange(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(s)}
              className={menuItemClass({ description: true })}
            >
              <span
                className="max-w-28 min-w-10 shrink-0 truncate font-mono text-caption text-accent-ink"
                title={s.command}
              >
                {s.command}
              </span>
              <OptionText label={s.name} description={s.description} />
              {isLocalCommandItem(s) ? (
                <span className="shrink-0 text-micro text-fg-3">{t('agent.skills.command')}</span>
              ) : s.source !== 'builtin' ? (
                <span className="shrink-0 text-micro text-fg-3">
                  {s.source === 'user' ? t('agent.skills.custom') : t('agent.skills.agentMade')}
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <ListFeedback count={items.length}>
          <EmptyState variant="no-results" title={t('agent.skills.noMatches')} compact className="py-3" />
        </ListFeedback>
      </div>
    </div>
  )
}

function KeyHints() {
  const t = useT()
  return (
    <div className="flex items-center gap-2.5 text-micro text-fg-3">
      <span className="flex items-center gap-1">
        <Kbd keys="↑↓" /> {t('agent.mention.hintSelect')}
      </span>
      <span className="flex items-center gap-1">
        <Kbd keys="↵" /> {t('agent.mention.hintInsert')}
      </span>
      <span className="flex items-center gap-1">
        <Kbd keys="esc" /> {t('common.close')}
      </span>
    </div>
  )
}
