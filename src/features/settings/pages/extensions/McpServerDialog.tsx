/**
 * Add / edit one MCP server: name + id (the tool-name namespace), connection (local command with arguments and
 * folder, or an http / sse URL), env vars or headers whose values go to the secret store, the default tool access
 * and the timeout. Inline errors under each field; main re-validates and asks natively before a new command runs.
 */
import { Plus, Server, X } from 'lucide-react'
import { useId, useState } from 'react'
import { isReservedMcpEnvName, MCP_SECRET_NAME_PATTERN, type McpServerView, type McpTransport } from '@aiwc/protocol'
import { useT } from '@/i18n'
import {
  Button,
  FormDialog,
  FormDialogField,
  IconButton,
  InlineHint,
  Input,
  SegmentedControl,
  Select,
  Textarea,
  toast,
} from '@/kit'
import { invoke } from '@/platform/hooks'
import { errorMessage } from '../../hooks'
import {
  blankMcpForm,
  MCP_RISKS,
  mcpDraftFromForm,
  mcpFormFromView,
  RISK_DESCRIPTION,
  RISK_LABEL,
  suggestServerId,
  TRANSPORT_LABEL,
  validateMcpForm,
  type McpForm,
  type McpFormField,
} from '../../extensionsModel'

export interface McpServerDialogProps {
  /** Absent = add a new server. */
  server?: McpServerView
  takenIds: readonly string[]
  onClose(): void
  onSaved(view: McpServerView): void
}

const TRANSPORTS: readonly McpTransport[] = ['stdio', 'http', 'sse']

export function McpServerDialog({ server, takenIds, onClose, onSaved }: McpServerDialogProps) {
  const t = useT()
  const ids = useId()
  const [form, setForm] = useState<McpForm>(() => (server ? mcpFormFromView(server) : blankMcpForm()))
  const [touched, setTouched] = useState<ReadonlySet<McpFormField>>(() => new Set())
  const [attempted, setAttempted] = useState(false)
  const [idEdited, setIdEdited] = useState(Boolean(server))

  const errors = validateMcpForm(form, takenIds)
  const shown = (field: McpFormField) => (attempted || touched.has(field) ? errors[field] : undefined)
  const visibleErrors = (Object.keys(errors) as McpFormField[]).some((f) => shown(f))
  const set = (patch: Partial<McpForm>, field?: McpFormField) => {
    setForm((prev) => ({ ...prev, ...patch }))
    if (field) setTouched((prev) => new Set(prev).add(field))
  }

  const submit = async () => {
    if (Object.keys(errors).length > 0) {
      setAttempted(true)
      return
    }
    try {
      const result = await invoke('mcp:save', mcpDraftFromForm(form))
      if (!result.ok) {
        toast.warning(t('settings.extensions.mcp.notConfirmed'))
        return
      }
      toast.success(t('settings.extensions.mcp.saved', { name: result.value.label }))
      onSaved(result.value)
    } catch (e) {
      toast.error(t('settings.extensions.mcp.saveFailed'), { detail: errorMessage(e) })
    }
  }

  const secretsLabel =
    form.transport === 'stdio'
      ? t('settings.extensions.mcp.form.secretsStdio')
      : t('settings.extensions.mcp.form.secretsHttp')
  const errorText = (field: McpFormField) => {
    const key = shown(field)
    return key ? t(key) : undefined
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      icon={Server}
      size="xl"
      title={server ? t('settings.extensions.mcp.form.titleEdit') : t('settings.extensions.mcp.form.titleAdd')}
      description={t('settings.extensions.mcp.form.description')}
      submitLabel={t('settings.extensions.mcp.form.save')}
      cancelLabel={t('settings.extensions.mcp.form.cancel')}
      submitDisabled={visibleErrors}
      submitDisabledReason={t('settings.extensions.mcp.form.fixErrors')}
      onSubmit={submit}
    >
      <FormDialogField label={t('settings.extensions.mcp.form.name')} htmlFor={`${ids}-label`}>
        <Input
          id={`${ids}-label`}
          value={form.label}
          autoFocus
          error={errorText('label')}
          onChange={(e) =>
            set({ label: e.target.value, ...(idEdited ? {} : { id: suggestServerId(e.target.value) }) }, 'label')
          }
        />
      </FormDialogField>
      <FormDialogField label={t('settings.extensions.mcp.form.id')} htmlFor={`${ids}-id`}>
        <Input
          id={`${ids}-id`}
          mono
          value={form.id}
          error={errorText('id')}
          hint={errorText('id') ? undefined : t('settings.extensions.mcp.form.idHint', { id: form.id || '…' })}
          onChange={(e) => {
            setIdEdited(true)
            set({ id: e.target.value.trim() }, 'id')
          }}
        />
      </FormDialogField>
      <FormDialogField label={t('settings.extensions.mcp.form.transport')}>
        <SegmentedControl
          aria-label={t('settings.extensions.mcp.form.transport')}
          options={TRANSPORTS.map((value) => ({ value, label: t(TRANSPORT_LABEL[value]) }))}
          value={form.transport}
          onValueChange={(transport) => set({ transport })}
        />
      </FormDialogField>
      {form.transport === 'stdio' ? (
        <>
          <FormDialogField label={t('settings.extensions.mcp.form.command')} htmlFor={`${ids}-command`}>
            <Input
              id={`${ids}-command`}
              mono
              value={form.command}
              placeholder="npx"
              error={errorText('command')}
              onChange={(e) => set({ command: e.target.value }, 'command')}
            />
          </FormDialogField>
          <FormDialogField label={t('settings.extensions.mcp.form.args')} htmlFor={`${ids}-args`} alignTop>
            <Textarea
              id={`${ids}-args`}
              mono
              autosize
              minRows={2}
              maxRows={6}
              value={form.args}
              hint={t('settings.extensions.mcp.form.argsHint')}
              onChange={(e) => set({ args: e.target.value })}
            />
          </FormDialogField>
          <FormDialogField label={t('settings.extensions.mcp.form.cwd')} htmlFor={`${ids}-cwd`}>
            <Input
              id={`${ids}-cwd`}
              mono
              value={form.cwd}
              placeholder={t('settings.extensions.mcp.form.cwdPlaceholder')}
              error={errorText('cwd')}
              onChange={(e) => set({ cwd: e.target.value }, 'cwd')}
            />
          </FormDialogField>
        </>
      ) : (
        <FormDialogField label={t('settings.extensions.mcp.form.url')} htmlFor={`${ids}-url`}>
          <Input
            id={`${ids}-url`}
            mono
            value={form.url}
            placeholder="https://"
            error={errorText('url')}
            hint={errorText('url') ? undefined : t('settings.extensions.mcp.form.urlHint')}
            onChange={(e) => set({ url: e.target.value }, 'url')}
          />
        </FormDialogField>
      )}
      <FormDialogField label={secretsLabel} alignTop>
        <div className="flex min-w-0 flex-col gap-2">
          {form.secrets.map((secret, index) => (
            <div key={index} className="flex min-w-0 items-center gap-2">
              <Input
                mono
                size="sm"
                wrapperClassName="w-36 shrink-0"
                aria-label={t('settings.extensions.mcp.form.secretName')}
                placeholder={t('settings.extensions.mcp.form.secretName')}
                value={secret.name}
                error={
                  Boolean(shown('secrets')) &&
                  (!MCP_SECRET_NAME_PATTERN.test(secret.name.trim()) ||
                    (form.transport === 'stdio' && isReservedMcpEnvName(secret.name)))
                }
                onChange={(e) =>
                  set(
                    { secrets: form.secrets.map((s, i) => (i === index ? { ...s, name: e.target.value } : s)) },
                    'secrets',
                  )
                }
              />
              <Input
                mono
                size="sm"
                type="password"
                wrapperClassName="min-w-0 flex-1"
                aria-label={t('settings.extensions.mcp.form.secretValue')}
                placeholder={
                  secret.stored
                    ? t('settings.extensions.mcp.form.secretStored')
                    : t('settings.extensions.mcp.form.secretValue')
                }
                value={secret.value}
                onChange={(e) =>
                  set({ secrets: form.secrets.map((s, i) => (i === index ? { ...s, value: e.target.value } : s)) })
                }
              />
              <IconButton
                icon={X}
                size="sm"
                label={t('settings.extensions.mcp.form.removeSecret', { name: secret.name || '…' })}
                onClick={() => set({ secrets: form.secrets.filter((_, i) => i !== index) }, 'secrets')}
              />
            </div>
          ))}
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              icon={Plus}
              onClick={() => set({ secrets: [...form.secrets, { name: '', value: '', stored: false }] })}
            >
              {t('settings.extensions.mcp.form.addSecret')}
            </Button>
            <span className="min-w-0 truncate text-micro text-fg-3">
              {t('settings.extensions.mcp.form.secretsHint')}
            </span>
          </div>
          {shown('secrets') ? <InlineHint kind="error">{t(shown('secrets')!)}</InlineHint> : null}
        </div>
      </FormDialogField>
      <FormDialogField label={t('settings.extensions.mcp.form.defaultRisk')}>
        <Select
          fullWidth
          aria-label={t('settings.extensions.mcp.form.defaultRisk')}
          options={MCP_RISKS.map((risk) => ({
            value: risk,
            label: t(RISK_LABEL[risk]),
            description: t(RISK_DESCRIPTION[risk]),
          }))}
          value={form.defaultRisk}
          onValueChange={(defaultRisk) => set({ defaultRisk })}
        />
      </FormDialogField>
      <FormDialogField label={t('settings.extensions.mcp.form.timeout')} htmlFor={`${ids}-timeout`}>
        <Input
          id={`${ids}-timeout`}
          inputMode="numeric"
          wrapperClassName="w-28"
          value={form.timeoutSec}
          error={errorText('timeout')}
          onChange={(e) => set({ timeoutSec: e.target.value.trim() }, 'timeout')}
        />
      </FormDialogField>
    </FormDialog>
  )
}
