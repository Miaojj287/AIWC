/**
 * 键盘快捷键 — the shortcut sheet (⌘/ / Ctrl+/ and Help › Keyboard Shortcuts): every global binding from the shortcut
 * registry plus the Agent composer's keys, grouped, with platform-correct labels (shortcutSheet.ts).
 */
import { Keyboard } from 'lucide-react'
import { useMemo } from 'react'
import { useT, type MessageKey } from '@/i18n'
import { Dialog, DialogBody, DialogContent, DialogHeader, Kbd } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { formatShortcut } from './shortcuts'
import { shortcutSheet, type SheetGroupId } from './shortcutSheet'

const GROUP_TITLE: Record<SheetGroupId, MessageKey> = {
  features: 'app.shortcuts.groups.features',
  navigation: 'app.shortcuts.groups.navigation',
  layout: 'app.shortcuts.groups.layout',
  agent: 'app.shortcuts.groups.agent',
  composer: 'app.shortcuts.groups.composer',
  help: 'app.shortcuts.groups.help',
}

export interface ShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mac: boolean
  web: boolean
}

export function ShortcutsDialog({ open, onOpenChange, mac, web }: ShortcutsDialogProps) {
  const t = useT()
  const sendKey = useConfig((c) => c.ui.composerSendKey) ?? 'enter'
  const groups = useMemo(() => shortcutSheet({ mac, web, sendKey }), [mac, web, sendKey])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader
          icon={Keyboard}
          title={t('app.shortcuts.title')}
          description={t('app.shortcuts.description', { keys: formatShortcut({ key: '/', mod: true }, mac) })}
        />
        <DialogBody className="max-h-[60vh] overflow-y-auto">
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <section key={group.id} aria-labelledby={`shortcuts-${group.id}`} className="flex flex-col gap-1">
                <h3 id={`shortcuts-${group.id}`} className="m-0 text-caption font-medium text-fg-3">
                  {t(GROUP_TITLE[group.id])}
                </h3>
                <dl className="m-0 flex flex-col">
                  {group.rows.map((row) => (
                    <div
                      key={row.id}
                      className="flex min-h-8 items-center justify-between gap-4 border-b border-line-8 last:border-b-0"
                    >
                      <dt className="min-w-0 truncate text-body text-fg">{t(row.label)}</dt>
                      <dd className="m-0 shrink-0">
                        <Kbd keys={row.keys} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
