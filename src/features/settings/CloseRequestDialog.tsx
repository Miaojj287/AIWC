/**
 * 关闭 AIWC? — shown when 常规 › 关闭窗口时 = 每次询问 and main pushes 'app:closeRequested'
 * (board 151:415 ②). Mount once in the shell root; it renders nothing until asked.
 */
import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { Button, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Radio, RadioGroup, toast } from '@/kit'
import { invoke, useBridgeEvent } from '@/platform/hooks'
import { errorMessage } from './hooks'

type Behavior = 'quit' | 'minimize'

export function CloseRequestDialog() {
  const [open, setOpen] = useState(false)
  const [behavior, setBehavior] = useState<Behavior>('minimize')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)

  useBridgeEvent('app:closeRequested', () => {
    setBehavior('minimize')
    setRemember(false)
    setOpen(true)
  })

  const confirm = async () => {
    setBusy(true)
    try {
      await invoke('app:setCloseBehaviorOnce', { behavior, remember })
      setOpen(false)
    } catch (e) {
      toast.error('操作失败', { detail: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogContent size="sm">
        <DialogHeader icon={LogOut} tone="accent" title="关闭 AIWC？" description="关闭窗口后，自动回复与推送任务将停止运行。" />
        <DialogBody>
          <RadioGroup value={behavior} onValueChange={(v) => setBehavior(v as Behavior)} aria-label="关闭方式">
            <Radio value="minimize" label="最小化到菜单栏，后台继续运行" />
            <Radio value="quit" label="完全退出" />
          </RadioGroup>
          <Checkbox checked={remember} onCheckedChange={(c) => setRemember(c === true)} label="记住我的选择，不再询问" description="之后可在 设置 › 常规 › 关闭窗口时 修改" />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void confirm()} loading={busy}>
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
