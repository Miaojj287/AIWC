/**
 * 设置 › 技能: every skill folder (built-in, the user's, the Agent's) as one setting row each — source badge, status
 * badge, description, on/off toggle, ··· and the same right-click menu (查看 / 设为定时任务… / 删除…). A broken
 * SKILL.md stays listed with the reason under it. All list states are covered: loading, error, empty, no results.
 */
import { CalendarClock, Ellipsis, Eye, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { SkillEntry } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import {
  Badge,
  Card,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DangerDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  InlineHint,
  SearchBox,
  SegmentedControl,
  SettingRow,
  SkeletonListRows,
  toast,
  Toggle,
  type MenuSpec,
} from '@/kit'
import { invoke } from '@/platform/hooks'
import { reloadSkills, useSkills } from '@/platform/skills'
import { errorMessage } from '../hooks'
import { Section } from '../pageKit'
import {
  DIAGNOSTIC_LABEL,
  FILTER_LABEL,
  filterSkills,
  scheduleSkillPayload,
  SKILL_FILTERS,
  skillStatus,
  SOURCE_LABEL,
  type SkillFilter,
} from '../skillsModel'
import { SkillDetailDialog } from './skills/SkillDetailDialog'

function StatusBadge({ skill }: { skill: SkillEntry }) {
  const t = useT()
  switch (skillStatus(skill)) {
    case 'broken':
      return <Badge tone="danger">{t('settings.skills.badge.broken')}</Badge>
    case 'disabled':
      return <Badge tone="neutral">{t('settings.skills.badge.disabled')}</Badge>
    case 'warning':
      return <Badge tone="warn">{t('settings.skills.badge.warning')}</Badge>
    case 'ok':
      return null
  }
}

export function SkillsPage() {
  const t = useT()
  const { entries, status } = useSkills()
  const [filter, setFilter] = useState<SkillFilter>('all')
  const [query, setQuery] = useState('')
  const [viewing, setViewing] = useState<SkillEntry | null>(null)
  const [deleting, setDeleting] = useState<SkillEntry | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const shown = filterSkills(entries, filter, query)

  const setEnabled = async (skill: SkillEntry, enabled: boolean) => {
    setBusy(skill.id)
    try {
      await invoke('skills:setEnabled', { name: skill.name, enabled })
      toast.success(
        t(enabled ? 'settings.skills.toasts.enabled' : 'settings.skills.toasts.disabled', { name: skill.name }),
      )
    } catch (e) {
      toast.error(t('settings.skills.toasts.toggleFailed'), { detail: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }
  const remove = async (skill: SkillEntry) => {
    try {
      await invoke('skills:delete', { id: skill.id })
      toast.success(t('settings.skills.toasts.deleted', { name: skill.name }))
    } catch (e) {
      toast.error(t('settings.skills.toasts.deleteFailed'), { detail: errorMessage(e) })
    }
  }
  const schedule = (skill: SkillEntry) => {
    setViewing(null)
    runCommand('tab.openTask', scheduleSkillPayload(skill))
  }

  const menuFor = (skill: SkillEntry): MenuSpec => [
    { id: 'view', label: t('settings.skills.menu.view'), icon: Eye, onSelect: () => setViewing(skill) },
    {
      id: 'schedule',
      label: t('settings.skills.menu.schedule'),
      icon: CalendarClock,
      disabled: !skill.usable,
      onSelect: () => schedule(skill),
    },
    ...(skill.deletable
      ? ([
          { type: 'separator' },
          {
            id: 'delete',
            label: t('settings.skills.menu.delete'),
            icon: Trash2,
            danger: true,
            onSelect: () => setDeleting(skill),
          },
        ] satisfies MenuSpec)
      : []),
  ]

  const body = (() => {
    if (status !== 'ready' && entries.length === 0) {
      if (status === 'error')
        return (
          <EmptyState
            variant="error"
            compact
            bordered
            title={t('settings.skills.loadFailed')}
            action={{ label: t('settings.skills.retry'), onClick: () => void reloadSkills() }}
          />
        )
      return <SkeletonListRows rows={3} avatar={false} />
    }
    if (entries.length === 0)
      return (
        <EmptyState
          compact
          bordered
          title={t('settings.skills.empty.title')}
          description={t('settings.skills.empty.description')}
        />
      )
    if (shown.length === 0)
      return <EmptyState variant="no-results" compact bordered title={t('settings.skills.noResults')} />
    return (
      <Card variant="rows">
        {shown.map((skill) => (
          <ContextMenu key={skill.id}>
            <ContextMenuTrigger asChild>
              <SettingRow
                title={<span className="font-mono">{skill.command}</span>}
                badge={
                  <>
                    <Badge tone={skill.source === 'agent' ? 'clone' : 'neutral'}>{t(SOURCE_LABEL[skill.source])}</Badge>
                    <StatusBadge skill={skill} />
                  </>
                }
                description={
                  <span className="line-clamp-2" title={skill.description}>
                    {skill.description || t('settings.skills.noDescription')}
                  </span>
                }
                footer={
                  skill.diagnostics.length ? (
                    <div className="flex flex-col gap-1">
                      {skill.diagnostics.map((code) => (
                        <InlineHint key={code} kind={skill.usable ? 'warning' : 'error'} live={false}>
                          {t(DIAGNOSTIC_LABEL[code])}
                        </InlineHint>
                      ))}
                    </div>
                  ) : undefined
                }
              >
                <Toggle
                  checked={skill.enabled}
                  disabled={!skill.usable || busy === skill.id}
                  onCheckedChange={(on) => void setEnabled(skill, on)}
                  label={t('settings.skills.toggle', { name: skill.name })}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton icon={Ellipsis} size="sm" label={t('settings.skills.more', { name: skill.name })} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItems items={menuFor(skill)} />
                  </DropdownMenuContent>
                </DropdownMenu>
              </SettingRow>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItems items={menuFor(skill)} />
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </Card>
    )
  })()

  return (
    <>
      <Section
        id="skills.list"
        title={t('settings.skills.section')}
        help={t('settings.skills.sectionHelp')}
        aside={entries.length ? t('settings.skills.count', { n: entries.length }) : undefined}
      >
        {entries.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl<SkillFilter>
              aria-label={t('settings.skills.section')}
              value={filter}
              onValueChange={setFilter}
              options={SKILL_FILTERS.map((f) => ({ value: f, label: t(FILTER_LABEL[f]) }))}
            />
            <SearchBox
              wrapperClassName="min-w-40 flex-1"
              value={query}
              onValueChange={setQuery}
              placeholder={t('settings.skills.search')}
              aria-label={t('settings.skills.search')}
            />
          </div>
        ) : null}
        {body}
      </Section>
      {viewing ? <SkillDetailDialog skill={viewing} onClose={() => setViewing(null)} onSchedule={schedule} /> : null}
      <DangerDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('settings.skills.delete.title', { name: deleting?.name ?? '' })}
        description={t('settings.skills.delete.description')}
        confirmLabel={t('settings.skills.delete.confirm')}
        onConfirm={() => {
          const skill = deleting
          setDeleting(null)
          if (skill) void remove(skill)
        }}
      />
    </>
  )
}
