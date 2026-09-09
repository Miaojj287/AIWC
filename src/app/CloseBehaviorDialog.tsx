import { Power } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AiwcBridge } from '@aiwc/protocol'
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
  const [remember, setRemember] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) setRemember(false)
  }, [open])
  const tray = platform === 'darwin' ? '菜单栏' : '系统托盘'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <DialogHeader icon={Power} tone="accent" title="关闭窗口" description={`AIWC 可以留在${tray}继续同步与自动回复。要退出，还是最小化到${tray}？`} />
        <DialogBody>
          <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} label="记住我的选择" description="之后可在 设置 › 常规 › 关闭窗口时 修改" />
        </DialogBody>
        <DialogFooter>
          <Button ref={cancelRef} variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="outline" onClick={() => onChoose('quit', remember)}>
            退出
          </Button>
          <Button variant="primary" onClick={() => onChoose('minimize', remember)}>
            最小化到{tray}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
