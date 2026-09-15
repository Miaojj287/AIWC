/**
 * 记忆 — the four bounded Markdown files with an embedded editor (dirty state, 保存 / 重置) and the
 * memory policy rows. Figma 128:1390, board 151:415 ⑤.
 */
import { FileText, RotateCcw, Save, Trash } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { MemoryBudget, MemoryFile } from '@aiwc/protocol'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DangerDialog,
  ICON_STROKE,
  InlineHint,
  Input,
  ProgressBar,
  SettingRow,
  Textarea,
  Toggle,
  cn,
  toast,
} from '@/kit'
import { useT } from '@/i18n'
import { useConfig } from '@/platform/configStore'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import { errorMessage, saveConfig } from '../hooks'
import {
  MEMORY_FILES,
  budgetRatio,
  memoryFileName,
  memoryStatusLine,
  overBudget,
  parseMaxEntries,
} from '../memoryModel'
import { PagePlaceholder, SRow, Section, useReportDirty } from '../pageKit'

interface FileInfo {
  count?: number
  budget?: MemoryBudget
}

function useMemoryOverview() {
  const [info, setInfo] = useState<Partial<Record<MemoryFile, FileInfo>>>({})
  const load = useCallback(async (file: MemoryFile) => {
    try {
      const [entries, budget] = await Promise.all([
        invoke('memory:entries', { file }),
        invoke('memory:budget', { file }),
      ])
      setInfo((s) => ({ ...s, [file]: { count: entries.length, budget } }))
    } catch {
      setInfo((s) => ({ ...s, [file]: {} }))
    }
  }, [])
  useEffect(() => {
    for (const m of MEMORY_FILES) void load(m.file)
  }, [load])
  return { info, reload: load }
}

export function MemoryPage() {
  const t = useT()
  const memory = useConfig((c) => c.memory)
  const appInfo = useInvoke('app:getInfo', undefined, [])
  const { info, reload } = useMemoryOverview()
  const [file, setFile] = useState<MemoryFile>('MEMORY')
  const [original, setOriginal] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [loadError, setLoadError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const [pendingSwitch, setPendingSwitch] = useState<MemoryFile | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [maxRaw, setMaxRaw] = useState<string | null>(null)
  const dirty = original !== null && draft !== original
  // Tell the tab, so closing it (or leaving for another settings page) asks before dropping the edits.
  useReportDirty('memory.editor', dirty)

  const loadFile = useCallback(async (f: MemoryFile) => {
    setLoadError(undefined)
    try {
      const md = await invoke('memory:read', { file: f })
      setOriginal(md)
      setDraft(md)
    } catch (e) {
      setLoadError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    setOriginal(null)
    void loadFile(file)
  }, [file, loadFile])

  useBridgeEvent('memory:changed', (e) => {
    void reload(e.file)
    if (e.file === file && !dirty) void loadFile(file)
  })

  if (!memory) return <PagePlaceholder rows={4} />

  const budget = info[file]?.budget
  const tooLong = overBudget(draft, budget)

  const select = (f: MemoryFile) => {
    if (f === file) return
    if (dirty) setPendingSwitch(f)
    else setFile(f)
  }

  const save = async () => {
    setSaving(true)
    try {
      await invoke('memory:write', { file, markdown: draft })
      setOriginal(draft)
      void reload(file)
      toast.success(t('settings.memory.editor.saved', { file: memoryFileName(file) }))
    } catch (e) {
      toast.error(t('common.saveFailed'), { detail: errorMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    try {
      await invoke('memory:clear', { file })
      setClearOpen(false)
      await loadFile(file)
      void reload(file)
      toast.success(t('settings.memory.clear.cleared', { file: memoryFileName(file) }))
    } catch (e) {
      toast.error(t('settings.memory.clear.failed'), { detail: errorMessage(e) })
    }
  }

  const commitMax = async () => {
    if (maxRaw === null) return
    const parsed = parseMaxEntries(maxRaw)
    if (parsed.ok) {
      if (parsed.value !== memory.maxEntries) await saveConfig({ memory: { maxEntries: parsed.value } })
      setMaxRaw(null)
    }
  }
  const maxCheck = maxRaw === null ? undefined : parseMaxEntries(maxRaw)
  const path = appInfo.data ? `${appInfo.data.dataDir}/memory/${memoryFileName(file)}` : memoryFileName(file)

  return (
    <>
      <Section title={t('settings.memory.sections.files')}>
        <Card variant="rows" data-setting-row="memory.files">
          {MEMORY_FILES.map((m) => {
            const active = m.file === file
            return (
              <SettingRow
                key={m.file}
                className={cn('cursor-pointer hover:bg-hover-5', active && 'bg-accent-12 hover:bg-accent-12')}
                onClick={() => select(m.file)}
                title={
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex size-7 items-center justify-center rounded-control',
                        active ? 'bg-accent-15 text-accent' : 'bg-line-6 text-fg-3',
                      )}
                    >
                      <FileText size={13} strokeWidth={ICON_STROKE} aria-hidden />
                    </span>
                    <span className="font-mono">{memoryFileName(m.file)}</span>
                    <span className="text-fg-2">{t(m.label)}</span>
                  </span>
                }
                description={`${t(m.description)} · ${memoryStatusLine(info[m.file]?.count, info[m.file]?.budget)}`}
              >
                {active ? (
                  <Badge tone="accent">
                    {dirty ? t('settings.memory.editingUnsaved') : t('settings.memory.editing')}
                  </Badge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => select(m.file)}>
                    {t('common.edit')}
                  </Button>
                )}
              </SettingRow>
            )
          })}
        </Card>
      </Section>

      <Section
        title={t('settings.memory.editor.section', { file: memoryFileName(file) })}
        aside={
          <span className="font-mono" title={path}>
            {path}
          </span>
        }
      >
        <Card className="flex flex-col gap-0 p-0" data-setting-row="memory.editor">
          {loadError ? (
            <div className="p-4">
              <InlineHint kind="error">{loadError}</InlineHint>
            </div>
          ) : (
            <Textarea
              mono
              autosize
              minRows={10}
              maxRows={26}
              aria-label={t('settings.memory.editor.label', { file: memoryFileName(file) })}
              value={draft}
              disabled={original === null}
              placeholder={original === null ? t('settings.memory.loading') : t('settings.memory.editor.placeholder')}
              onChange={(e) => setDraft(e.target.value)}
              className="rounded-b-none border-0 bg-transparent px-4 py-3 focus:border-0"
            />
          )}
          <div className="flex items-center gap-3 border-t border-line-6 px-4 py-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {dirty ? (
                <span className="text-caption text-accent">{t('settings.memory.editor.modified')}</span>
              ) : (
                <span className="text-caption text-fg-3">
                  {budget ? t('settings.memory.used', { used: budget.usedChars, limit: budget.limitChars }) : ''}
                </span>
              )}
              {budget ? (
                <ProgressBar
                  value={budgetRatio(budget) * 100}
                  label={t('settings.memory.editor.capacity')}
                  className="w-[100px]"
                />
              ) : null}
              {tooLong ? (
                <InlineHint kind="error" truncate>
                  {t('settings.memory.editor.overBudget')}
                </InlineHint>
              ) : null}
            </div>
            <Button variant="ghost" icon={RotateCcw} disabled={!dirty} onClick={() => setConfirmReset(true)}>
              {t('common.reset')}
            </Button>
            <Button
              variant="primary"
              icon={Save}
              disabled={!dirty || tooLong}
              loading={saving}
              onClick={() => void save()}
              title={
                !dirty
                  ? t('settings.memory.editor.noChanges')
                  : tooLong
                    ? t('settings.memory.editor.tooLong')
                    : undefined
              }
            >
              {t('common.save')}
            </Button>
          </div>
        </Card>
      </Section>

      <Section title={t('settings.memory.sections.policy')}>
        <Card variant="rows">
          <SRow
            id="memory.autoWrite"
            title={t('settings.memory.autoWrite.title')}
            description={t('settings.memory.autoWrite.description')}
            htmlFor="memory-auto"
          >
            <Toggle
              id="memory-auto"
              checked={memory.autoWrite}
              onCheckedChange={(autoWrite) => void saveConfig({ memory: { autoWrite } })}
            />
          </SRow>
          <SRow
            id="memory.confirmBeforeWrite"
            title={t('settings.memory.confirmBeforeWrite.title')}
            description={t('settings.memory.confirmBeforeWrite.description')}
            htmlFor="memory-confirm"
          >
            <Toggle
              id="memory-confirm"
              checked={memory.confirmBeforeWrite}
              onCheckedChange={(confirmBeforeWrite) => void saveConfig({ memory: { confirmBeforeWrite } })}
            />
          </SRow>
          <SRow
            id="memory.maxEntries"
            title={t('settings.memory.maxEntries.title')}
            description={t('settings.memory.maxEntries.description')}
            htmlFor="memory-max"
            footer={maxCheck && !maxCheck.ok ? <InlineHint kind="error">{maxCheck.error}</InlineHint> : null}
          >
            <Input
              id="memory-max"
              type="number"
              size="sm"
              inputMode="numeric"
              min={10}
              max={2000}
              value={maxRaw ?? String(memory.maxEntries)}
              onChange={(e) => setMaxRaw(e.target.value)}
              onBlur={() => void commitMax()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitMax()
                if (e.key === 'Escape') setMaxRaw(null)
              }}
              error={maxCheck ? !maxCheck.ok : undefined}
              trailing={<span className="text-micro text-fg-3">{t('settings.memory.maxEntries.unit')}</span>}
              wrapperClassName="w-[104px]"
            />
          </SRow>
          <SRow
            id="memory.clear"
            title={t('settings.memory.clear.title', { file: memoryFileName(file) })}
            description={t('settings.memory.clear.description')}
          >
            <Button
              variant="ghost"
              icon={Trash}
              className="text-danger hover:text-danger"
              onClick={() => setClearOpen(true)}
            >
              {t('common.clear')}
            </Button>
          </SRow>
        </Card>
      </Section>

      <ConfirmDialog
        open={pendingSwitch !== null}
        onOpenChange={(o) => !o && setPendingSwitch(null)}
        title={t('settings.memory.discard.title')}
        description={t('settings.memory.discard.description', { file: memoryFileName(file) })}
        confirmLabel={t('settings.memory.discard.confirm')}
        cancelLabel={t('settings.memory.discard.cancel')}
        tone="warn"
        onConfirm={() => {
          if (pendingSwitch) setFile(pendingSwitch)
          setPendingSwitch(null)
        }}
      />
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t('settings.memory.discard.title')}
        description={t('settings.memory.discard.description', { file: memoryFileName(file) })}
        confirmLabel={t('settings.memory.discard.confirm')}
        cancelLabel={t('settings.memory.discard.cancel')}
        tone="warn"
        onConfirm={() => {
          if (original !== null) setDraft(original)
          setConfirmReset(false)
        }}
      />
      <DangerDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={t('settings.memory.clear.dialogTitle', { file: memoryFileName(file) })}
        description={t('settings.memory.clear.dialogDescription', { n: info[file]?.count ?? 0 })}
        confirmLabel={t('common.clear')}
        confirmWord={file}
        onConfirm={clear}
      />
    </>
  )
}
