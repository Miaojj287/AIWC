/**
 * Image / video lightbox: a Dialog with the media fitted to the viewport (Figma: 图片消息 → 点击放大). An image zooms
 * and pans (kit ZoomPan: wheel / pinch, drag, double-click resets, + / − / 0).
 */
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, IconButton, ZoomPan } from '@/kit'
import { useT } from '@/i18n'
import { openLocalPath } from '@/platform/openExternal'

/** What the lightbox shows: `kind` comes from the message type, never from the (translated) alt text. */
export interface LightboxItem {
  src: string
  alt: string
  kind: 'image' | 'video'
}

export interface LightboxProps {
  item: LightboxItem | null
  onClose(): void
}

export function Lightbox({ item, onClose }: LightboxProps) {
  const t = useT()
  // Closing clears `item` at once, but the dialog is still on screen for its exit: keep showing the last media so
  // the 120ms fade never animates an empty shell.
  const [shown, setShown] = useState(item)
  if (item && item !== shown) setShown(item)
  const media = item ?? shown
  const isVideo = media?.kind === 'video'
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl" className="w-auto max-w-[min(92vw,1200px)] items-center bg-shell p-3">
        <DialogTitle className="sr-only">{media?.alt ?? t('chat.lightbox.media')}</DialogTitle>
        <DialogDescription className="sr-only">{t('chat.lightbox.closeHint')}</DialogDescription>
        {media ? (
          isVideo ? (
            <video src={media.src} controls autoPlay className="max-h-[80vh] max-w-full rounded-item bg-black" />
          ) : (
            <ZoomPan label={media.alt} className="h-[80vh] w-[min(88vw,1176px)]">
              <img
                src={media.src}
                alt={media.alt}
                draggable={false}
                className="max-h-[80vh] max-w-full select-none rounded-item object-contain"
              />
            </ZoomPan>
          )
        ) : null}
        {media && !media.src.startsWith('data:') ? (
          <div className="absolute left-3 top-3">
            <IconButton
              icon={ExternalLink}
              label={t('chat.lightbox.openWithSystem')}
              onClick={() => void openLocalPath(media.src, t('chat.openTarget.mediaFile'))}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
