import { Button, Card, InlineHint, toast } from '@/kit'
import { invoke, useBridgeEvent, useInvoke } from '@/platform/hooks'

/**
 * Whatever currently stands between an enabled rule and a sent message.
 *
 * There is no global switch to show: the per-chat toggle is the only control, so anything that
 * stops it is a fault worth reporting, not a setting. When nothing is wrong this renders nothing —
 * an empty warning strip would just be another thing to scan past.
 */
export function AutoReplyControl() {
  const status = useInvoke('autoreply:status', undefined, [])
  useBridgeEvent('substrate:event', () => status.reload())
  useBridgeEvent('gateway:event', (e) => {
    if (e.type === 'adapter.state' || e.type === 'autoreply.halted') status.reload()
  })

  const resume = async () => {
    try {
      await invoke('autoreply:resume', undefined)
    } catch (e) {
      toast.error('恢复失败', { detail: String(e) })
    }
    status.reload()
  }

  const blocked = status.data?.demo ? 'demo' : status.data && status.data.connection !== 'ready' ? 'offline' : undefined
  if (!blocked && !status.data?.halted) return null

  return (
    <Card variant="rows">
      <div className="flex flex-col gap-2 px-4 py-3">
        {blocked === 'demo' ? <InlineHint kind="warning">当前是演示数据，真实微信消息监听未启动。</InlineHint> : null}
        {blocked === 'offline' ? <InlineHint kind="warning">请先在设置中连接微信数据，连接成功后才能监听新消息。</InlineHint> : null}
        {status.data?.halted ? (
          <>
            <InlineHint kind="error">自动发送已暂停：{status.data.halted}</InlineHint>
            <Button variant="outline" onClick={() => void resume()}>
              我已确认，恢复自动发送
            </Button>
          </>
        ) : null}
      </div>
    </Card>
  )
}
