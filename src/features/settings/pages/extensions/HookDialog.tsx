/**
 * Add / edit one user hook: event, tool matcher (tool events only), the command, timeout and sandbox. Main asks
 * natively before a new command — or one that leaves the sandbox — is saved.
 */
import { Webhook } from 'lucide-react'
import { useId, useState } from 'react'
import { USER_HOOK_EVENTS, type UserHookView } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { FormDialog, FormDialogField, Input, Select, SettingRow, Textarea, toast, Toggle } from '@/kit'
import { invoke } from '@/platform/hooks'
import { errorMessage } from '../../hooks'
import {
  blankHookForm,
  HOOK_EVENT_DESCRIPTION,
  HOOK_EVENT_LABEL,
  hookDraftFromForm,
  hookFormFromView,
  isToolEvent,
  validateHookForm,
  type HookForm,
  type HookFormField,
} from '../../extensionsModel'

export interface HookDialogProps {
  hook?: UserHookView
  /** The OS can sandbox hook commands (and the shell sandbox is on). */
  sandboxAvailable: boolean
  onClose(): void
  onSaved(view: UserHookView): void
}

export function HookDialog({ hook, sandboxAvailable, onClose, onSaved }: HookDialogProps) {
  const t = useT()
  const ids = useId()
  const [form, setForm] = useState<HookForm>(() => (hook ? hookFormFromView(hook) : blankHookForm()))
  const [touched, setTouched] = useState<ReadonlySet<HookFormField>>(() => new Set())
  const [attempted, setAttempted] = useState(false)

  const errors = validateHookForm(form)
  const shown = (field: HookFormField) => {
    const key = attempted || touched.has(field) ? errors[field] : undefined
    return key ? t(key) : undefined
  }
  const visibleErrors = (Object.keys(errors) as HookFormField[]).some((f) => shown(f))
  const set = (patch: Partial<HookForm>, field?: HookFormField) => {
    setForm((prev) => ({ ...prev, ...patch }))
    if (field) setTouched((prev) => new Set(prev).add(field))
  }

  const submit = async () => {
    if (Object.keys(errors).length > 0) {
      setAttempted(true)
      return
    }
    try {
      const result = await invoke('hooks:save', hookDraftFromForm(form))
      if (!result.ok) {
        toast.warning(t('settings.extensions.mcp.notConfirmed'))
        return
      }
      toast.success(t('settings.extensions.hooks.saved'))
      onSaved(result.value)
    } catch (e) {
      toast.error(t('settings.extensions.hooks.saveFailed'), { detail: errorMessage(e) })
    }
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      icon={Webhook}
      size="xl"
      title={hook ? t('settings.extensions.hooks.form.titleEdit') : t('settings.extensions.hooks.form.titleAdd')}
      description={t('settings.extensions.hooks.form.description')}
      submitLabel={t('settings.extensions.hooks.form.save')}
      cancelLabel={t('settings.extensions.hooks.form.cancel')}
      submitDisabled={visibleErrors}
      submitDisabledReason={t('settings.extensions.hooks.form.fixErrors')}
      onSubmit={submit}
    >
      <FormDialogField label={t('settings.extensions.hooks.form.name')} htmlFor={`${ids}-label`}>
        <Input
          id={`${ids}-label`}
          value={form.label}
          placeholder={t('settings.extensions.hooks.form.namePlaceholder')}
          onChange={(e) => set({ label: e.target.value })}
        />
      </FormDialogField>
      <FormDialogField label={t('settings.extensions.hooks.form.event')}>
        <Select
          fullWidth
          aria-label={t('settings.extensions.hooks.form.event')}
          options={USER_HOOK_EVENTS.map((event) => ({
            value: event,
            label: t(HOOK_EVENT_LABEL[event]),
            description: t(HOOK_EVENT_DESCRIPTION[event]),
          }))}
          value={form.event}
          onValueChange={(event) => set({ event })}
        />
      </FormDialogField>
      {isToolEvent(form.event) ? (
        <FormDialogField label={t('settings.extensions.hooks.form.matcher')} htmlFor={`${ids}-matcher`}>
          <Input
            id={`${ids}-matcher`}
            mono
            value={form.matcher}
            placeholder="*"
            error={shown('matcher')}
            hint={shown('matcher') ? undefined : t('settings.extensions.hooks.form.matcherHint')}
            onChange={(e) => set({ matcher: e.target.value }, 'matcher')}
          />
        </FormDialogField>
      ) : null}
      <FormDialogField label={t('settings.extensions.hooks.form.command')} htmlFor={`${ids}-command`} alignTop>
        <Textarea
          id={`${ids}-command`}
          mono
          autosize
          minRows={2}
          maxRows={8}
          value={form.command}
          error={shown('command')}
          hint={shown('command') ? undefined : t('settings.extensions.hooks.form.commandHint')}
          onChange={(e) => set({ command: e.target.value }, 'command')}
        />
      </FormDialogField>
      <FormDialogField label={t('settings.extensions.hooks.form.timeout')} htmlFor={`${ids}-timeout`}>
        <Input
          id={`${ids}-timeout`}
          inputMode="numeric"
          wrapperClassName="w-28"
          value={form.timeoutSec}
          error={shown('timeout')}
          onChange={(e) => set({ timeoutSec: e.target.value.trim() }, 'timeout')}
        />
      </FormDialogField>
      <SettingRow
        className="px-0 py-2"
        title={t('settings.extensions.hooks.form.sandbox')}
        description={
          sandboxAvailable
            ? t('settings.extensions.hooks.form.sandboxDesc')
            : t('settings.extensions.hooks.form.sandboxUnavailable')
        }
      >
        <Toggle
          checked={form.sandbox && sandboxAvailable}
          disabled={!sandboxAvailable}
          label={t('settings.extensions.hooks.form.sandbox')}
          onCheckedChange={(sandbox) => set({ sandbox })}
        />
      </SettingRow>
    </FormDialog>
  )
}
