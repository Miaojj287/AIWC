/**
 * 来自会话 (设置 › 记忆): the entries of the open memory file that an Agent thread wrote, each linked back to that
 * thread. Shown only when there are such entries; the editor above stays the place to change them.
 */
import { MessageSquare } from 'lucide-react'
import type { MemoryFile, ThreadSummary } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Button, Card, InlineHint, SettingRow } from '@/kit'
import { runCommand } from '@/app/commands'
import { useBridgeEvent, useInvoke } from '@/platform/hooks'
import { Section } from '../pageKit'

/** Threads looked up for titles; an entry from an older thread still links, under a generic name. */
const THREAD_LOOKUP_LIMIT = 500

export function MemoryProvenance({ file }: { file: MemoryFile }) {
  const t = useT()
  const entries = useInvoke('memory:entries', { file }, [file])
  const threads = useInvoke('agent:listThreads', { limit: THREAD_LOOKUP_LIMIT, channel: 'desktop' }, [])
  useBridgeEvent('memory:changed', (e) => {
    if (e.file === file) entries.reload()
  })
  const written = (entries.data ?? []).filter((e) => e.threadId)
  if (entries.error) return <InlineHint kind="error">{t('settings.memory.provenance.loadFailed')}</InlineHint>
  if (written.length === 0) return null
  const byId = new Map<string, ThreadSummary>((threads.data ?? []).map((th) => [th.threadId, th]))

  return (
    <Section title={t('settings.memory.provenance.title')} help={t('settings.memory.provenance.help')}>
      <Card variant="rows">
        {written.map((entry) => {
          const threadId = entry.threadId ?? ''
          const thread = byId.get(threadId)
          const label = thread
            ? t('settings.memory.provenance.fromThread', {
                title: thread.title || t('settings.memory.provenance.untitled'),
              })
            : t('settings.memory.provenance.deletedThread')
          return (
            <SettingRow
              key={`${entry.index}:${threadId}`}
              title={<span className="line-clamp-2 break-words font-normal">{entry.text}</span>}
            >
              <Button
                variant="link"
                size="sm"
                icon={MessageSquare}
                disabled={!thread}
                disabledReason={thread ? undefined : t('settings.memory.provenance.deletedThread')}
                onClick={() => runCommand('agent.openThread', { threadId })}
                title={label}
                className="max-w-[220px]"
              >
                <span className="min-w-0 truncate">{label}</span>
              </Button>
            </SettingRow>
          )
        })}
      </Card>
    </Section>
  )
}
