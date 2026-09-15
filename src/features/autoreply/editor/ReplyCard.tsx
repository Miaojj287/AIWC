/**
 * 回复方式 card — the entire rule. 发送方式 (segmented) decides whether a reply waits for 确认发送
 * or counts down; 回复来源 (segmented) swaps the rows below:
 *   固定文案 → the text that gets sent, with variable chips
 *   AI 生成  → the system prompt, and how many past messages the model reads
 */
import { Plus } from 'lucide-react'
import { useRef } from 'react'
import type { AutoReplyRule, ReplySendMode, ReplySource } from '@aiwc/protocol'
import { useT, type MessageKey } from '@/i18n'
import { Card, Chip, InlineHint, Input, SegmentedControl, SettingRow, Textarea } from '@/kit'
import { useConfig } from '@/platform/configStore'
import {
  HISTORY_COUNT_OPTIONS,
  RULE_VARIABLES,
  RULE_VARIABLE_LABELS,
  SEND_MODE_OPTIONS,
  SOURCE_OPTIONS,
  insertAtCursor,
  type RuleErrors,
} from '../ruleModel'

export interface ReplyCardProps {
  draft: AutoReplyRule
  errors: RuleErrors
  patch: (p: Partial<AutoReplyRule>) => void
}

const SOURCE_DESCRIPTION: Record<ReplySource, MessageKey> = {
  fixed: 'autoreply.reply.sourceDescription.fixed',
  ai: 'autoreply.reply.sourceDescription.ai',
}

export function ReplyCard({ draft, errors, patch }: ReplyCardProps) {
  const t = useT()
  const textRef = useRef<HTMLTextAreaElement>(null)
  const historyCount = draft.historyCount
  const countdownMs = useConfig((c) => c.autoReply.countdownMs) ?? 5000
  const sendMode: ReplySendMode = draft.sendMode ?? 'auto'
  const sendModeDescriptionKey = SEND_MODE_OPTIONS.find((o) => o.value === sendMode)?.descriptionKey
  const sendModeDescription =
    sendMode === 'auto' && countdownMs > 0
      ? t('autoreply.reply.autoCountdown', { n: Math.round(countdownMs / 1000) })
      : sendModeDescriptionKey
        ? t(sendModeDescriptionKey)
        : undefined

  const insertVariable = (token: string) => {
    const el = textRef.current
    const cursor = el?.selectionStart ?? (draft.fixedText ?? '').length
    const next = insertAtCursor(draft.fixedText ?? '', cursor, token)
    patch({ fixedText: next.text })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(next.cursor, next.cursor)
    })
  }

  return (
    <Card variant="rows">
      <SettingRow title={t('autoreply.reply.sendMode')} description={sendModeDescription}>
        <SegmentedControl<ReplySendMode>
          aria-label={t('autoreply.reply.sendMode')}
          value={sendMode}
          options={SEND_MODE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          onValueChange={(mode) => patch({ sendMode: mode })}
        />
      </SettingRow>
      <SettingRow title={t('autoreply.reply.source')} description={t(SOURCE_DESCRIPTION[draft.source])}>
        <SegmentedControl<ReplySource>
          aria-label={t('autoreply.reply.source')}
          value={draft.source}
          options={SOURCE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          onValueChange={(source) => patch({ source })}
        />
      </SettingRow>

      {draft.source === 'fixed' ? (
        <SettingRow
          title={t('autoreply.reply.fixedText')}
          description={t('autoreply.reply.fixedTextDescription')}
          stacked
          footer={
            errors.fixedText && (draft.fixedText ?? '') !== '' ? (
              <InlineHint kind="error">{errors.fixedText}</InlineHint>
            ) : null
          }
        >
          <div className="flex flex-col gap-2">
            <Textarea
              ref={textRef}
              autosize
              minRows={3}
              maxRows={8}
              aria-label={t('autoreply.reply.fixedText')}
              value={draft.fixedText ?? ''}
              placeholder={t('autoreply.reply.fixedTextPlaceholder', { nickname: RULE_VARIABLES[0] })}
              onChange={(e) => patch({ fixedText: e.target.value })}
              error={Boolean(errors.fixedText) && (draft.fixedText ?? '') !== '' ? true : undefined}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-micro text-fg-3">{t('autoreply.reply.insertVariable')}</span>
              {RULE_VARIABLES.map((v) => (
                <Chip
                  key={v}
                  label={t(RULE_VARIABLE_LABELS[v], { token: v })}
                  icon={Plus}
                  onClick={() => insertVariable(v)}
                  className="font-mono"
                />
              ))}
            </div>
          </div>
        </SettingRow>
      ) : (
        <>
          <SettingRow
            title={t('autoreply.reply.systemPrompt')}
            description={t('autoreply.reply.systemPromptDescription')}
            stacked
          >
            <Textarea
              autosize
              minRows={4}
              maxRows={14}
              aria-label={t('autoreply.reply.systemPrompt')}
              value={draft.prompt ?? ''}
              placeholder={t('autoreply.reply.promptPlaceholder')}
              onChange={(e) => patch({ prompt: e.target.value })}
            />
          </SettingRow>
          <SettingRow
            title={t('autoreply.reply.historyCount')}
            description={t('autoreply.reply.historyCountDescription')}
            footer={errors.historyCount ? <InlineHint kind="error">{errors.historyCount}</InlineHint> : null}
          >
            <div className="flex items-center gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {HISTORY_COUNT_OPTIONS.map((n) => (
                  <Chip
                    key={n}
                    label={String(n)}
                    selected={historyCount === n}
                    onClick={() => patch({ historyCount: n })}
                    aria-label={t('autoreply.rule.historyCount', { n })}
                  />
                ))}
              </div>
              <Input
                size="sm"
                type="number"
                mono
                aria-label={t('autoreply.reply.historyCount')}
                value={String(historyCount ?? '')}
                onChange={(e) => patch({ historyCount: Number(e.target.value) })}
                error={Boolean(errors.historyCount) || undefined}
                wrapperClassName="w-[84px]"
              />
              <span className="text-micro text-fg-3">{t('autoreply.reply.historyCountUnit')}</span>
            </div>
          </SettingRow>
        </>
      )}
    </Card>
  )
}
