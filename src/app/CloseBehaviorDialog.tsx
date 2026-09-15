import { Power } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AiwcBridge } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { Button, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/kit'

export type CloseBehavior = 'quit' | 'minimize'

export interface CloseBehaviorDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  onChoose(behavior: CloseBehavior, remember: boolean): void
  platform: AiwcBridge['platform']
}

/**
 * Asked when config.general.closeBehavior === 'ask' and the window's × is pressed (DESIGN-SPEC §2 常规):
 * 退出 / 最小化到菜单栏 + 「记住我的选择」. Default focus on 取消; the safe choice (keep running) is primary.
 */
export function CloseBehaviorDialog({ open, onOpenChange, onChoose, platform }: CloseBehaviorDialogProps) {
  const t = useT()
  const [remember, setRemember] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) setRemember(false)
  }, [open])
  const tray = platform === 'darwin' ? 'menuBar' : 'tray'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <DialogHeader
          icon={Power}
          tone="accent"
          title={t('app.closeDialog.title')}
          description={t('app.closeDialog.description', { tray })}
        />
        <DialogBody>
          <Checkbox
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
            label={t('app.closeDialog.remember')}
            description={t('app.closeDialog.rememberHint')}
          />
        </DialogBody>
        <DialogFooter>
          <Button ref={cancelRef} variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="outline" onClick={() => onChoose('quit', remember)}>
            {t('app.closeDialog.quit')}
          </Button>
          <Button variant="primary" onClick={() => onChoose('minimize', remember)}>
            {t('app.closeDialog.minimize', { tray })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
