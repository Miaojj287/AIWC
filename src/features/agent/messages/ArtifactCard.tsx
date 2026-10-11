import { ChevronRight, Copy, ExternalLink, FileText, FolderOpen, Image } from 'lucide-react'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import {
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  ICON_STROKE,
  toast,
  type MenuSpec,
} from '@/kit'
import { invoke } from '@/platform/hooks'
import type { ThreadItem } from '../model'
import { copyText } from './CopyAction'

export type ArtifactItem = Extract<ThreadItem, { kind: 'artifact' }>

export interface ArtifactCardProps {
  item: ArtifactItem
  /** Defaults to opening the file in a workspace tab (tab.openFile). */
  onOpen?: (item: ArtifactItem) => void
}

export function openArtifact(item: ArtifactItem): void {
  const { artifact } = item
  if (artifact.path) runCommand('tab.openFile', { path: artifact.path, title: artifact.title })
}

/**
 * ResultCard — a generated file: accent icon box 28, title 12 Medium, subtitle 11 weak, chevron. Click opens the
 * workspace tab (Figma 120:483 / 150:1005 ResultCard); right click offers open / show in folder / copy path.
 */
export function ArtifactCard({ item, onOpen }: ArtifactCardProps) {
  const t = useT()
  const { artifact } = item
  const openable = Boolean(artifact.path) || Boolean(onOpen)
  const Icon = artifact.kind === 'image' ? Image : FileText
  const subtitle = artifact.path
    ? t('agent.artifact.clickToOpen')
    : artifact.kind === 'markdown'
      ? t('agent.artifact.notSaved')
      : t('agent.artifact.generated')
  const open = () => (onOpen ? onOpen(item) : openArtifact(item))
  const path = artifact.path
  const menu: MenuSpec = path
    ? [
        { id: 'open', label: t('agent.artifact.open'), icon: ExternalLink, onSelect: open },
        {
          id: 'reveal',
          label: t('agent.artifact.reveal'),
          icon: FolderOpen,
          onSelect: () =>
            void invoke('file:reveal', { path }).catch((e: unknown) =>
              toast.error(t('common.operationFailedDetail', { detail: e instanceof Error ? e.message : String(e) })),
            ),
        },
        { id: 'copyPath', label: t('agent.artifact.copyPath'), icon: Copy, onSelect: () => void copyText(path) },
      ]
    : []
  const card = (
    <div
      role={openable ? 'button' : undefined}
      tabIndex={openable ? 0 : undefined}
      onClick={openable ? open : undefined}
      onKeyDown={(e) => {
        if (!openable) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      data-item="artifact"
      className={cn(
        'flex w-full items-center gap-2.5 rounded-item border border-line-8 bg-content py-2 pl-2 pr-2.5 outline-none transition-colors',
        openable && 'cursor-pointer hover:border-(--line-16) hover:bg-hover-5',
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-control bg-accent-15 text-accent">
        <Icon size={14} strokeWidth={ICON_STROKE} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-caption font-medium text-fg" title={artifact.path ?? artifact.title}>
          {artifact.title}
        </span>
        <span className="truncate text-micro text-fg-3">{subtitle}</span>
      </span>
      {openable ? (
        <ChevronRight size={14} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-fg-3" />
      ) : null}
    </div>
  )
  if (menu.length === 0) return card
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={menu} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
