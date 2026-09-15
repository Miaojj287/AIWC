/**
 * Draft state for the rule editor: load → edit → validate → save, plus optimistic enable / disable and
 * delete. Dirty = the edited fields differ from the last saved rule (rulesEqual).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AutoReplyRule } from '@aiwc/protocol'
import { useT } from '@/i18n'
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
  const t = useT()
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

  const errors = useMemo(() => (draft ? validateRule(draft, t) : {}), [draft, t])
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
      toast.success(t('autoreply.editor.saved', { name: sessionTitle }))
      return result
    } catch (e) {
      toast.error(t('autoreply.editor.saveFailed'), { detail: message(e) })
      return undefined
    } finally {
      setSaving(false)
    }
  }, [draft, valid, sessionTitle, t])

  const reset = useCallback(() => setDraft(saved), [saved])

  const remove = useCallback(async () => {
    try {
      await invoke('autoreply:deleteRule', { sessionId })
      const fresh = newRule(sessionId)
      setSaved(fresh)
      setDraft(fresh)
      toast.success(t('autoreply.rule.deletedToast', { name: sessionTitle }))
      return true
    } catch (e) {
      toast.error(t('autoreply.editor.deleteFailed'), { detail: message(e) })
      return false
    }
  }, [sessionId, sessionTitle, t])

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      patch({ enabled })
      if (!saved?.id) {
        // No rule exists yet, so the switch only edits the draft. Say so — silently flipping a switch
        // that changes nothing is exactly the "did that work?" moment 交互准则 1 forbids.
        toast.info(enabled ? t('autoreply.editor.saveToActivate') : t('autoreply.editor.notSavedToast'), {
          detail: t('autoreply.editor.saveRuleHint'),
        })
        return
      }
      const before = saved
      setSaved({ ...saved, enabled })
      try {
        await invoke('autoreply:setEnabled', { sessionId, enabled })
        toast.success(
          enabled
            ? t('autoreply.rule.enabledToast', { name: sessionTitle })
            : t('autoreply.rule.pausedToast', { name: sessionTitle }),
          {
            detail: enabled ? t('autoreply.rule.enabledToastDetail') : undefined,
          },
        )
      } catch (e) {
        setSaved(before)
        patch({ enabled: before.enabled })
        toast.error(t('autoreply.rule.toggleFailed'), { detail: message(e) })
      }
    },
    [patch, saved, sessionId, sessionTitle, t],
  )

  return {
    loading: loaded.loading && !draft,
    error: loaded.error,
    reload: loaded.reload,
    draft,
    saved,
    exists: Boolean(saved?.id),
    errors,
    valid,
    dirty,
    saving,
    patch,
    save,
    reset,
    remove,
    setEnabled,
  }
}
