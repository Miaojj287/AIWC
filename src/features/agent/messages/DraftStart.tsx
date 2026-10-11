/**
 * Top of an empty thread: nothing at all (CLAUDE.md §14 — the composer alone), or — while no model is usable — a call
 * to action that opens 设置 › AI 接入 (the composer stays, so a draft typed meanwhile is kept). Shared by the panel and
 * the Agent window through ThreadConversation.
 */
import { Plug } from 'lucide-react'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import { EmptyState } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { hasUsableModel } from '@/platform/modelAvailability'

export function DraftStart({ className }: { className?: string }) {
  const t = useT()
  const providers = useConfig((c) => c.ai.providers)
  // Config not loaded yet: stay blank rather than flash the setup prompt.
  if (providers === undefined || hasUsableModel(providers)) return null
  return (
    <EmptyState
      className={className}
      compact
      icon={Plug}
      title={t('agent.empty.noModel.title')}
      action={{
        label: t('agent.empty.noModel.action'),
        onClick: () => runCommand('tab.openSettings', { page: 'ai', highlight: 'ai.providers' }),
      }}
    />
  )
}
