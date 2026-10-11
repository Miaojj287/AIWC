/**
 * 设置 › 技能 › 查看: the rendered SKILL.md with its metadata (command, source, parameters, where the file lives) and
 * what is wrong with it. Read-only; editing a skill is the Agent's job (`skill_manage`) or the user's own editor.
 */
import { CalendarClock, WandSparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SkillEntry } from '@aiwc/protocol'
import { useT } from '@/i18n'
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  InlineHint,
  Markdown,
  Skeleton,
} from '@/kit'
import { useInvoke } from '@/platform/hooks'
import { DIAGNOSTIC_LABEL, SOURCE_LABEL } from '../../skillsModel'

export interface SkillDetailDialogProps {
  skill: SkillEntry
  onClose(): void
  onSchedule(skill: SkillEntry): void
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3 text-caption">
      <span className="w-16 shrink-0 text-fg-3">{label}</span>
      <div className="min-w-0 flex-1 text-fg">{children}</div>
    </div>
  )
}

export function SkillDetailDialog({ skill, onClose, onSchedule }: SkillDetailDialogProps) {
  const t = useT()
  const detail = useInvoke('skills:get', { id: skill.id }, [skill.id])
  const data = detail.data
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="xl">
        <DialogHeader
          icon={WandSparkles}
          title={skill.name}
          description={skill.description || t('settings.skills.noDescription')}
        />
        <DialogBody className="max-h-[64vh] gap-4">
          <div className="flex flex-col gap-1.5">
            <MetaRow label={t('settings.skills.detail.command')}>
              <span className="font-mono">{skill.command}</span>
            </MetaRow>
            <MetaRow label={t('settings.skills.detail.source')}>
              <Badge tone={skill.source === 'agent' ? 'clone' : 'neutral'}>{t(SOURCE_LABEL[skill.source])}</Badge>
            </MetaRow>
            <MetaRow label={t('settings.skills.detail.params')}>
              {skill.params.length ? (
                <ul className="flex flex-col gap-0.5">
                  {skill.params.map((p) => (
                    <li key={p.name} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className="font-mono">{p.name}</span>
                      <span className="text-fg-3">
                        {p.required ? t('settings.skills.detail.required') : t('settings.skills.detail.optional')}
                      </span>
                      {p.default ? (
                        <span className="text-fg-3">
                          {t('settings.skills.detail.defaultValue', { value: p.default })}
                        </span>
                      ) : null}
                      {p.description ? <span className="min-w-0 break-words text-fg-2">{p.description}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-fg-3">{t('settings.skills.detail.noParams')}</span>
              )}
            </MetaRow>
            <MetaRow label={t('settings.skills.detail.location')}>
              {data ? (
                <span className="block truncate font-mono text-fg-2" title={data.path}>
                  {data.path}
                </span>
              ) : (
                <Skeleton className="h-4 w-48" />
              )}
              <span className="text-micro text-fg-3">{t('settings.skills.detail.size', { n: skill.size })}</span>
            </MetaRow>
          </div>
          {skill.diagnostics.length ? (
            <div className="flex flex-col gap-1">
              {skill.diagnostics.map((code) => (
                <InlineHint key={code} kind={skill.usable ? 'warning' : 'error'} live={false}>
                  {t(DIAGNOSTIC_LABEL[code])}
                </InlineHint>
              ))}
            </div>
          ) : null}
          <div className="rounded-item border border-line-8 bg-content px-4 py-3">
            {detail.loading && !data ? (
              <EmptyState compact variant="loading" title={t('settings.skills.detail.loading')} />
            ) : detail.error && !data ? (
              <EmptyState
                compact
                variant="error"
                title={t('settings.skills.detail.loadFailed')}
                description={detail.error.message}
                action={{ label: t('settings.skills.retry'), onClick: detail.reload }}
              />
            ) : data?.body ? (
              <>
                <Markdown source={data.body} />
                {data.truncated ? (
                  <InlineHint kind="info" className="mt-2">
                    {t('settings.skills.detail.truncated')}
                  </InlineHint>
                ) : null}
              </>
            ) : (
              <EmptyState compact title={t('settings.skills.detail.empty')} />
            )}
          </div>
        </DialogBody>
        <DialogFooter actions>
          <Button
            variant="outline"
            icon={CalendarClock}
            disabled={!skill.usable}
            disabledReason={t('settings.skills.badge.broken')}
            onClick={() => onSchedule(skill)}
          >
            {t('settings.skills.menu.schedule')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('settings.skills.detail.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
