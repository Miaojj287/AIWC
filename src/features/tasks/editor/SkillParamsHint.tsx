/**
 * Under the task prompt: when it starts with `/技能`, which skill the run loads and the parameters that skill
 * declares (required ones not yet written as `name=value` are called out). Nothing for an ordinary prompt.
 */
import { parseSlashCommand, skillMatchesCommand } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { InlineHint } from '@/kit'
import { unfilledParams, useSkills } from '@/platform/skills'

export function SkillParamsHint({ prompt }: { prompt: string }) {
  const t = useT()
  const { entries, status } = useSkills()
  const slash = parseSlashCommand(prompt)
  if (!slash || status !== 'ready') return null
  const skill = entries.find((s) => s.usable && skillMatchesCommand(s, slash.command))
  if (!skill)
    return <InlineHint kind="warning">{t('tasks.editor.skill.unknown', { command: slash.command })}</InlineHint>
  if (!skill.enabled)
    return <InlineHint kind="warning">{t('tasks.editor.skill.disabled', { name: skill.name })}</InlineHint>
  const missing = unfilledParams(skill, prompt)
  return (
    <div className="flex flex-col gap-1.5">
      <InlineHint kind="info">{t('tasks.editor.skill.loads', { name: skill.name })}</InlineHint>
      {skill.params.length ? (
        <div className="flex flex-col gap-1 rounded-item border border-line-8 bg-content px-3 py-2">
          <div className="text-note font-medium text-fg-2">{t('tasks.editor.skill.params')}</div>
          <ul className="flex flex-col gap-0.5">
            {skill.params.map((p) => (
              <li key={p.name} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-note text-fg-3">
                <span className="font-mono text-fg">{p.name}</span>
                <span>{p.required ? t('tasks.editor.skill.required') : t('tasks.editor.skill.optional')}</span>
                {p.default ? <span>{t('tasks.editor.skill.defaultValue', { value: p.default })}</span> : null}
                {p.description ? <span className="min-w-0 break-words">{p.description}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {missing.length ? (
        <InlineHint kind="warning">
          {t('tasks.editor.skill.missing', { names: missing.map((p) => p.name).join(', ') })}
        </InlineHint>
      ) : null}
    </div>
  )
}
