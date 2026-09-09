/**
 * Draft state for the rule editor: load → edit → validate → save, plus optimistic enable / disable and
 * delete. Dirty = the edited fields differ from the last saved rule (rulesEqual).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AutoReplyRule } from '@aiwc/protocol'
import { toast } from '@/kit'
import { invoke, useInvoke } from '@/platform/hooks'
import { isRuleValid, newRule, rulesEqual, validateRule, type RuleErrors } from './ruleModel'

export interface RuleEditor {
  loading: boolean
  error: Error | undefined
  reload: () => void
  draft: AutoReplyRule | null
  saved: AutoReplyRule | null
  /** true when a rule exists in the backend (saved.id !== ''). */
  exists: boolean
  errors: RuleErrors
  valid: boolean
  dirty: boolean
  saving: boolean
  patch: (p: Partial<AutoReplyRule>) => void
  save: () => Promise<AutoReplyRule | undefined>
  reset: () => void
  remove: () => Promise<boolean>
  setEnabled: (enabled: boolean) => Promise<void>
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function useRuleEditor(sessionId: string, sessionTitle: string): RuleEditor {
  const loaded = useInvoke('autoreply:getRule', { sessionId }, [sessionId])
  const [draft, setDraft] = useState<AutoReplyRule | null>(null)
  const [saved, setSaved] = useState<AutoReplyRule | null>(null)
  const [saving, setSaving] = useState(false)
  const dirtyRef = useRef(false)

  // Adopt the loaded rule; never clobber an in-progress edit on a background reload.
  useEffect(() => {
    if (loaded.loading || loaded.error) return
    const base = loaded.data ?? newRule(sessionId)
    setSaved(base)
    setDraft((d) => (d && dirtyRef.current && d.sessionId === sessionId ? d : base))
  }, [loaded.data, loaded.loading, loaded.error, sessionId])

  useEffect(() => {
    setDraft(null)
    setSaved(null)
    dirtyRef.current = false
  }, [sessionId])

  const errors = useMemo(() => (draft ? validateRule(draft) : {}), [draft])
  const valid = isRuleValid(errors)
  const dirty = Boolean(draft && saved && !rulesEqual(draft, saved))
  dirtyRef.current = dirty

  const patch = useCallback((p: Partial<AutoReplyRule>) => setDraft((d) => (d ? { ...d, ...p } : d)), [])

  const save = useCallback(async () => {
    if (!draft || !valid) return undefined
    setSaving(true)
    try {
      const result = await invoke('autoreply:saveRule', draft)
      setSaved(result)
      setDraft(result)
      toast.success(`规则已保存 · ${sessionTitle}`)
      return result
    } catch (e) {
      toast.error('保存规则失败', { detail: message(e) })
      return undefined
    } finally {
      setSaving(false)
    }
  }, [draft, valid, sessionTitle])

  const reset = useCallback(() => setDraft(saved), [saved])

  const remove = useCallback(async () => {
    try {
      await invoke('autoreply:deleteRule', { sessionId })
      const fresh = newRule(sessionId)
      setSaved(fresh)
      setDraft(fresh)
      toast.success(`已删除「${sessionTitle}」的自动回复规则`)
      return true
    } catch (e) {
      toast.error('删除规则失败', { detail: message(e) })
      return false
    }
  }, [sessionId, sessionTitle])

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      patch({ enabled })
      if (!saved?.id) {
        // No rule exists yet, so the switch only edits the draft. Say so — silently flipping a switch
        // that changes nothing is exactly the "did that work?" moment 交互准则 1 forbids.
        toast.info(enabled ? '保存规则后自动回复才会生效' : '规则尚未保存', { detail: '点右下角「保存规则」' })
        return
      }
      const before = saved
      setSaved({ ...saved, enabled })
      try {
        await invoke('autoreply:setEnabled', { sessionId, enabled })
        toast.success(enabled ? `已启用「${sessionTitle}」的自动回复` : `已暂停「${sessionTitle}」的自动回复`, {
          detail: enabled ? '对方若还有没回的消息，会先补回一条' : undefined,
        })
      } catch (e) {
        setSaved(before)
        patch({ enabled: before.enabled })
        toast.error('切换失败', { detail: message(e) })
      }
    },
    [patch, saved, sessionId, sessionTitle],
  )

  return { loading: loaded.loading && !draft, error: loaded.error, reload: loaded.reload, draft, saved, exists: Boolean(saved?.id), errors, valid, dirty, saving, patch, save, reset, remove, setEnabled }
}
