/**
 * 复制规则到其他会话 (board 152:415 ②): search + checkbox list of sessions (已有规则 badge), then
 * saveRule(copyRuleTo(rule, sessionId)) for each. Uses the shared FormDialog.
 */
import { Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AutoReplyRule } from '@aiwc/protocol'
import { Avatar, Badge, Checkbox, FormDialog, SearchBox, SkeletonListRows, toast } from '@/kit'
import { invoke, useInvoke } from '@/platform/hooks'
import { copyRuleTo } from '../ruleModel'

export interface CopyRuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rule: AutoReplyRule
  sourceTitle: string
  onCopied?: (sessionIds: string[]) => void
}

export function CopyRuleDialog({ open, onOpenChange, rule, sourceTitle, onCopied }: CopyRuleDialogProps) {
  const sessions = useInvoke('substrate:listSessions', { limit: 500, kind: 'all' }, [open], { enabled: open })
  const rules = useInvoke('autoreply:listRules', undefined, [open], { enabled: open })
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)

  const withRule = useMemo(() => new Set((rules.data ?? []).map((r) => r.sessionId)), [rules.data])
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (sessions.data?.items ?? []).filter((s) => s.id !== rule.sessionId && (s.kind === 'dm' || s.kind === 'group') && (!q || s.title.toLowerCase().includes(q)))
  }, [sessions.data, query, rule.sessionId])

  const toggle = (id: string, on: boolean) =>
    setPicked((set) => {
      const next = new Set(set)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const submit = async () => {
    const ids = [...picked]
    setBusy(true)
    try {
      await Promise.all(ids.map((sid) => invoke('autoreply:saveRule', copyRuleTo(rule, sid))))
      toast.success(`已复制到 ${ids.length} 个会话 · 立即生效`)
      onCopied?.(ids)
      onOpenChange(false)
      setPicked(new Set())
    } catch (e) {
      toast.error('复制失败', { detail: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      icon={Copy}
      title="复制规则到其他会话"
      description={`把「${sourceTitle}」的回复方式与设定复制到所选会话，已有规则会被覆盖。`}
      submitLabel="复制"
      submitDisabled={picked.size === 0}
      submitDisabledReason="请先选择至少一个会话"
      loading={busy}
      onSubmit={submit}
    >
      <SearchBox size="sm" value={query} onValueChange={setQuery} placeholder="搜索会话" aria-label="搜索会话" />
      <div role="group" aria-label="目标会话" className="flex max-h-[280px] flex-col gap-px overflow-y-auto rounded-item border border-line-6 bg-content p-1">
        {sessions.loading && !sessions.data ? (
          <SkeletonListRows rows={4} className="p-2" />
        ) : candidates.length === 0 ? (
          <div className="px-3 py-6 text-center text-caption text-fg-3">{query ? `没有匹配「${query}」的会话` : '没有其他会话'}</div>
        ) : (
          candidates.map((s) => (
            <label key={s.id} className="flex h-10 cursor-pointer items-center gap-2.5 rounded-control px-2 hover:bg-hover-5">
              <Checkbox checked={picked.has(s.id)} onCheckedChange={(c) => toggle(s.id, c === true)} aria-label={s.title} />
              <Avatar id={s.id} name={s.title} src={s.avatarPath} size={28} />
              <span className="min-w-0 flex-1 truncate text-body text-fg">{s.title}</span>
              {withRule.has(s.id) ? <Badge tone="warn">已有规则</Badge> : null}
            </label>
          ))
        )}
      </div>
      <div className="text-note text-fg-3">已选 {picked.size} 个会话</div>
    </FormDialog>
  )
}
