/**
 * The rows 回复方式 = Jev（beta） adds to the 回复方式 card: the candidate replies Jev chooses between,
 * optional guidance, the 不回 option and the confidence threshold. (参考历史条数 is the card's shared
 * row.) A missing TypeSafe key shows as the first row, pointing at 设置 › AI 接入 › Jev.
 */
import { Plus, X } from 'lucide-react'
import type { AutoReplyRule } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import { Button, Chip, IconButton, InlineHint, Select, SettingRow, Textarea, Toggle } from '@/kit'
import { RULE_VARIABLES, type RuleErrors } from '../ruleModel'
import {
  JEV_CONFIDENCE_OPTIONS,
  JEV_MAX_CANDIDATES,
  addCandidate,
  canAddCandidate,
  jevConfigOf,
  percent,
  removeCandidate,
  setCandidate,
} from './jevModel'

export interface JevRowsProps {
  draft: AutoReplyRule
  errors: RuleErrors
  patch: (p: Partial<AutoReplyRule>) => void
  /** A TypeSafe key is saved (设置 › AI 接入 › Jev); without one the rule cannot run. */
  configured: boolean
}

export function JevRows({ draft, errors, patch, configured }: JevRowsProps) {
  const t = useT()
  const config = jevConfigOf(draft)
  const setJev = (next: typeof config) => patch({ jev: next })
  const candidatesTouched = config.candidates.some((c) => c.trim())
  const thresholdValue = String(config.minConfidence)

  return (
    <>
      {!configured ? (
        <SettingRow
          title={t('autoreply.jev.editor.notConfiguredTitle')}
          description={t('autoreply.jev.editor.notConfiguredDescription')}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => runCommand('tab.openSettings', { page: 'ai', highlight: 'ai.jev' })}
          >
            {t('autoreply.jev.editor.goSettings')}
          </Button>
        </SettingRow>
      ) : null}

      <SettingRow
        title={t('autoreply.jev.editor.candidates')}
        description={t('autoreply.jev.editor.candidatesDescription', {
          nickname: RULE_VARIABLES[0],
          time: RULE_VARIABLES[1],
          group: RULE_VARIABLES[2],
        })}
        stacked
        footer={
          errors.candidates && candidatesTouched ? <InlineHint kind="error">{errors.candidates}</InlineHint> : null
        }
      >
        <div className="flex flex-col gap-2" data-testid="jev-candidates">
          {config.candidates.map((text, index) => (
            <div key={index} className="flex items-start gap-2">
              <Chip label={String(index + 1)} className="mt-1.5 shrink-0 font-latin" aria-hidden tabIndex={-1} />
              <Textarea
                autosize
                minRows={1}
                maxRows={6}
                aria-label={t('autoreply.jev.editor.candidateLabel', { n: index + 1 })}
                value={text}
                placeholder={t('autoreply.jev.editor.candidatePlaceholder')}
                onChange={(e) => setJev(setCandidate(config, index, e.target.value))}
                wrapperClassName="min-w-0 flex-1"
              />
              <IconButton
                size="sm"
                icon={X}
                label={t('autoreply.jev.editor.removeCandidate', { n: index + 1 })}
                className="mt-1"
                onClick={() => setJev(removeCandidate(config, index))}
              />
            </div>
          ))}
          <div>
            <Button
              variant="outline"
              size="sm"
              icon={Plus}
              disabled={!canAddCandidate(config)}
              disabledReason={t('autoreply.jev.validation.tooMany', { max: JEV_MAX_CANDIDATES })}
              onClick={() => setJev(addCandidate(config))}
            >
              {t('autoreply.jev.editor.addCandidate')}
            </Button>
          </div>
        </div>
      </SettingRow>

      <SettingRow title={t('autoreply.jev.editor.instructions')} stacked>
        <Textarea
          autosize
          minRows={2}
          maxRows={8}
          aria-label={t('autoreply.jev.editor.instructions')}
          value={config.instructions ?? ''}
          placeholder={t('autoreply.jev.editor.instructionsPlaceholder')}
          onChange={(e) => setJev({ ...config, instructions: e.target.value })}
        />
      </SettingRow>

      <SettingRow title={t('autoreply.jev.editor.allowSilence')}>
        <Toggle
          label={t('autoreply.jev.editor.allowSilence')}
          checked={config.allowSilence}
          onCheckedChange={(allowSilence) => setJev({ ...config, allowSilence })}
        />
      </SettingRow>

      <SettingRow title={t('autoreply.jev.editor.minConfidence')} htmlFor="jev-min-confidence">
        <Select
          id="jev-min-confidence"
          aria-label={t('autoreply.jev.editor.minConfidence')}
          value={JEV_CONFIDENCE_OPTIONS.some((v) => String(v) === thresholdValue) ? thresholdValue : null}
          options={JEV_CONFIDENCE_OPTIONS.map((v) => ({
            value: String(v),
            label: t('autoreply.jev.editor.confidenceOption', { n: percent(v) }),
            description: t('autoreply.jev.editor.confidenceOptionDescription', { n: percent(v) }),
          }))}
          onValueChange={(v) => setJev({ ...config, minConfidence: Number(v) })}
          align="end"
          className="min-w-[120px]"
        />
      </SettingRow>
    </>
  )
}
