/**
 * Image / video lightbox: a Dialog with the media fitted to the viewport (Figma: 图片消息 → 点击放大).
 */
import { ExternalLink } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, IconButton } from '@/kit'
import { openLocalPath } from '@/platform/openExternal'

export interface LightboxProps {
  item: { src: string; alt: string } | null
  onClose(): void
}

export function Lightbox({ item, onClose }: LightboxProps) {
  const isVideo = item?.alt === '视频' && !/^data:image|\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(item.src)
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl" className="w-auto max-w-[min(92vw,1200px)] items-center bg-shell p-3">
        <DialogTitle className="sr-only">{item?.alt ?? '媒体'}</DialogTitle>
        <DialogDescription className="sr-only">按 Esc 关闭</DialogDescription>
        {item ? (
          isVideo ? (
            <video src={item.src} controls autoPlay className="max-h-[80vh] max-w-full rounded-item bg-black" />
          ) : (
            <img src={item.src} alt={item.alt} draggable={false} className="max-h-[80vh] max-w-full select-none rounded-item object-contain" />
          )
        ) : null}
        {item && !item.src.startsWith('data:') ? (
          <div className="absolute left-3 top-3">
            <IconButton icon={ExternalLink} label="用系统应用打开" onClick={() => void openLocalPath(item.src, '媒体文件')} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
