/**
 * 记忆 — the four bounded Markdown files with an embedded editor (dirty state, 保存 / 重置) and the
 * memory policy rows. Figma 128:1390, board 151:415 ⑤.
 */
import { FileText, RotateCcw, Save, Trash } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { MemoryBudget, MemoryFile } from '@aiwc/protocol'
import { Badge, Button, Card, ConfirmDialog, DangerDialog, ICON_STROKE, InlineHint, Input, ProgressBar, SettingRow, Textarea, Toggle, cn, toast } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'
import { errorMessage, saveConfig } from '../hooks'
import { MEMORY_FILES, budgetRatio, memoryFileName, memoryStatusLine, overBudget, parseMaxEntries } from '../memoryModel'
import { PagePlaceholder, SRow, Section, useReportDirty } from '../pageKit'

interface FileInfo {
  count?: number
  budget?: MemoryBudget
}

function useMemoryOverview() {
  const [info, setInfo] = useState<Partial<Record<MemoryFile, FileInfo>>>({})
  const load = useCallback(async (file: MemoryFile) => {
    try {
      const [entries, budget] = await Promise.all([invoke('memory:entries', { file }), invoke('memory:budget', { file })])
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
      toast.success(`已保存 ${memoryFileName(file)}`)
    } catch (e) {
      toast.error('保存失败', { detail: errorMessage(e) })
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
      toast.success(`已清空 ${memoryFileName(file)}`)
    } catch (e) {
      toast.error('清空失败', { detail: errorMessage(e) })
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
      <Section title="记忆文件">
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
                    <span className={cn('flex size-7 items-center justify-center rounded-control', active ? 'bg-accent-15 text-accent' : 'bg-line-6 text-fg-3')}>
                      <FileText size={13} strokeWidth={ICON_STROKE} aria-hidden />
                    </span>
                    <span className="font-mono">{memoryFileName(m.file)}</span>
                    <span className="text-fg-2">{m.label}</span>
                  </span>
                }
                description={`${m.description} · ${memoryStatusLine(info[m.file]?.count, info[m.file]?.budget)}`}
              >
                {active ? <Badge tone="accent">编辑中{dirty ? ' · 未保存' : ''}</Badge> : <Button variant="ghost" size="sm" onClick={() => select(m.file)}>编辑</Button>}
              </SettingRow>
            )
          })}
        </Card>
      </Section>

      <Section title={`编辑 ${memoryFileName(file)}`} aside={<span className="font-mono" title={path}>{path}</span>}>
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
              aria-label={`${memoryFileName(file)} 内容`}
              value={draft}
              disabled={original === null}
              placeholder={original === null ? '读取中…' : '（空文件）用 `- ` 开头写一条记忆'}
              onChange={(e) => setDraft(e.target.value)}
              className="rounded-b-none border-0 bg-transparent px-4 py-3 focus:border-0"
            />
          )}
          <div className="flex items-center gap-3 border-t border-line-6 px-4 py-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {dirty ? <span className="text-caption text-accent">已修改 · 未保存</span> : <span className="text-caption text-fg-3">{budget ? `已用 ${budget.usedChars} / ${budget.limitChars} 字` : ''}</span>}
              {budget ? <ProgressBar value={budgetRatio(budget) * 100} label="容量占用" className="w-[100px]" /> : null}
              {tooLong ? <InlineHint kind="error">超出容量上限，请精简后再保存</InlineHint> : null}
            </div>
            <Button variant="ghost" icon={RotateCcw} disabled={!dirty} onClick={() => setConfirmReset(true)}>
              重置
            </Button>
            <Button variant="primary" icon={Save} disabled={!dirty || tooLong} loading={saving} onClick={() => void save()} title={!dirty ? '没有未保存的修改' : tooLong ? '内容超出容量上限' : undefined}>
              保存
            </Button>
          </div>
        </Card>
      </Section>

      <Section title="记忆策略">
        <Card variant="rows">
          <SRow id="memory.autoWrite" title="自动写入记忆" description="会话结束时由 Agent 提炼要点写入 MEMORY.md" htmlFor="memory-auto">
            <Toggle id="memory-auto" checked={memory.autoWrite} onCheckedChange={(autoWrite) => void saveConfig({ memory: { autoWrite } })} />
          </SRow>
          <SRow id="memory.confirmBeforeWrite" title="写入前需要确认" description="关闭后 Agent 可直接修改记忆文件" htmlFor="memory-confirm">
            <Toggle id="memory-confirm" checked={memory.confirmBeforeWrite} onCheckedChange={(confirmBeforeWrite) => void saveConfig({ memory: { confirmBeforeWrite } })} />
          </SRow>
          <SRow id="memory.maxEntries" title="记忆条数上限" description="超出后按最久未使用淘汰（10 – 2000）" htmlFor="memory-max" footer={maxCheck && !maxCheck.ok ? <InlineHint kind="error">{maxCheck.error}</InlineHint> : null}>
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
              trailing={<span className="text-micro text-fg-3">条</span>}
              wrapperClassName="w-[104px]"
            />
          </SRow>
          <SRow id="memory.clear" title={`清空 ${memoryFileName(file)}`} description={`删除 ${memoryFileName(file)} 中的所有条目，不影响其他记忆文件`}>
            <Button variant="ghost" icon={Trash} className="text-danger hover:text-danger" onClick={() => setClearOpen(true)}>
              清空
            </Button>
          </SRow>
        </Card>
      </Section>

      <ConfirmDialog
        open={pendingSwitch !== null}
        onOpenChange={(o) => !o && setPendingSwitch(null)}
        title="放弃未保存的修改？"
        description={`${memoryFileName(file)} 将恢复到上次保存的内容。`}
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        tone="warn"
        onConfirm={() => {
          if (pendingSwitch) setFile(pendingSwitch)
          setPendingSwitch(null)
        }}
      />
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="放弃未保存的修改？"
        description={`${memoryFileName(file)} 将恢复到上次保存的内容。`}
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        tone="warn"
        onConfirm={() => {
          if (original !== null) setDraft(original)
          setConfirmReset(false)
        }}
      />
      <DangerDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={`清空 ${memoryFileName(file)}？`}
        description={`${info[file]?.count ?? 0} 条记忆将被永久删除，Agent 会忘记记在这里的事实与偏好。其他记忆文件不受影响。`}
        confirmLabel="清空"
        confirmWord={file}
        onConfirm={clear}
      />
    </>
  )
}
