/**
 * 回复方式 card — the entire rule. 回复来源 (segmented) swaps the rows below:
 *   固定文案 → the text that gets sent, with variable chips
 *   AI 生成  → the system prompt, and how many past messages the model reads
 */
import { Plus } from 'lucide-react'
import { useRef } from 'react'
import type { AutoReplyRule, ReplySource } from '@aiwc/protocol'
import { Card, Chip, InlineHint, Input, SegmentedControl, SettingRow, Textarea } from '@/kit'
import { HISTORY_COUNT_OPTIONS, RULE_VARIABLES, SOURCE_OPTIONS, insertAtCursor, type RuleErrors } from '../ruleModel'

export interface ReplyCardProps {
  draft: AutoReplyRule
  errors: RuleErrors
  patch: (p: Partial<AutoReplyRule>) => void
}

const SOURCE_DESCRIPTION: Record<ReplySource, string> = {
  fixed: '对方每条消息都回同一段文案，不调用模型',
  ai: '按下面的设定，参考这个会话的历史记录现写一条',
}

const PROMPT_PLACEHOLDER = '例如：你就是我本人。用我平时的语气回消息，短句、口语、别用书面语。涉及具体金额、时间和承诺时不要答，改说「我等下确认一下」。'

export function ReplyCard({ draft, errors, patch }: ReplyCardProps) {
  const textRef = useRef<HTMLTextAreaElement>(null)
  const historyCount = draft.historyCount

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
      <SettingRow title="回复方式" description={SOURCE_DESCRIPTION[draft.source]}>
        <SegmentedControl<ReplySource>
          aria-label="回复方式"
          value={draft.source}
          options={SOURCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          onValueChange={(source) => patch({ source })}
        />
      </SettingRow>

      {draft.source === 'fixed' ? (
        <SettingRow
          title="回复文案"
          description="原样发送；变量在发送时替换成真实的昵称、时间和群名"
          stacked
          footer={errors.fixedText && (draft.fixedText ?? '') !== '' ? <InlineHint kind="error">{errors.fixedText}</InlineHint> : null}
        >
          <div className="flex flex-col gap-2">
            <Textarea
              ref={textRef}
              autosize
              minRows={3}
              maxRows={8}
              aria-label="回复文案"
              value={draft.fixedText ?? ''}
              placeholder="例如：{昵称} 你好，我现在不在电脑旁，看到后会尽快回复你。"
              onChange={(e) => patch({ fixedText: e.target.value })}
              error={Boolean(errors.fixedText) && (draft.fixedText ?? '') !== '' ? true : undefined}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-micro text-fg-3">插入变量</span>
              {RULE_VARIABLES.map((v) => (
                <Chip key={v} label={v} icon={Plus} onClick={() => insertVariable(v)} className="font-mono" />
              ))}
            </div>
          </div>
        </SettingRow>
      ) : (
        <>
          <SettingRow title="System Prompt" description="AI 以什么身份、什么语气、什么边界来替你回复" stacked>
            <Textarea
              autosize
              minRows={4}
              maxRows={14}
              aria-label="System Prompt"
              value={draft.prompt ?? ''}
              placeholder={PROMPT_PLACEHOLDER}
              onChange={(e) => patch({ prompt: e.target.value })}
            />
          </SettingRow>
          <SettingRow
            title="参考历史条数"
            description="每次回复前读取这个会话最近多少条消息作为上下文"
            footer={errors.historyCount ? <InlineHint kind="error">{errors.historyCount}</InlineHint> : null}
          >
            <div className="flex items-center gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {HISTORY_COUNT_OPTIONS.map((n) => (
                  <Chip key={n} label={String(n)} selected={historyCount === n} onClick={() => patch({ historyCount: n })} aria-label={`参考 ${n} 条`} />
                ))}
              </div>
              <Input
                size="sm"
                type="number"
                mono
                aria-label="参考历史条数"
                value={String(historyCount ?? '')}
                onChange={(e) => patch({ historyCount: Number(e.target.value) })}
                error={Boolean(errors.historyCount) || undefined}
                wrapperClassName="w-[84px]"
              />
              <span className="text-micro text-fg-3">条</span>
            </div>
          </SettingRow>
        </>
      )}
    </Card>
  )
}
