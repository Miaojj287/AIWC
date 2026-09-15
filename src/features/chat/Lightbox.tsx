/**
 * Image / video lightbox: a Dialog with the media fitted to the viewport (Figma: 图片消息 → 点击放大).
 */
import { ExternalLink } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, IconButton } from '@/kit'
import { useT } from '@/i18n'
import { openLocalPath } from '@/platform/openExternal'

export interface LightboxProps {
  item: { src: string; alt: string } | null
  onClose(): void
}

export function Lightbox({ item, onClose }: LightboxProps) {
  const t = useT()
  // VideoBody opens with the translated 视频 alt (MessageMedia.tsx).
  const isVideo = item?.alt === t('chat.media.video') && !/^data:image|\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(item.src)
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl" className="w-auto max-w-[min(92vw,1200px)] items-center bg-shell p-3">
        <DialogTitle className="sr-only">{item?.alt ?? t('chat.lightbox.media')}</DialogTitle>
        <DialogDescription className="sr-only">{t('chat.lightbox.closeHint')}</DialogDescription>
        {item ? (
          isVideo ? (
            <video src={item.src} controls autoPlay className="max-h-[80vh] max-w-full rounded-item bg-black" />
          ) : (
            <img
              src={item.src}
              alt={item.alt}
              draggable={false}
              className="max-h-[80vh] max-w-full select-none rounded-item object-contain"
            />
          )
        ) : null}
        {item && !item.src.startsWith('data:') ? (
          <div className="absolute left-3 top-3">
            <IconButton
              icon={ExternalLink}
              label={t('chat.lightbox.openWithSystem')}
              onClick={() => void openLocalPath(item.src, t('chat.openTarget.mediaFile'))}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
