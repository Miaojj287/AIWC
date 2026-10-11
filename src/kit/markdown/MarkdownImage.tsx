/**
 * An image in Markdown (![alt](src)) on a surface that shows images (Markdown `resolveImage`): a bounded preview
 * that opens in a zoomable dialog (ZoomPan). An image that fails to load falls back to its alt text, like the
 * surfaces that do not show images at all.
 */
import { useState } from 'react'
import { useT } from '@/i18n'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../Dialog'
import { ZoomPan } from '../ZoomPan'
import { MARKDOWN_CLASS } from './styles'

export function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [broken, setBroken] = useState(false)
  if (broken)
    return (
      <span title={src} className={MARKDOWN_CLASS.link}>
        {alt || src}
      </span>
    )
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('kit.markdown.image.open')}
        title={t('kit.markdown.image.open')}
        className="my-1 inline-block max-w-full cursor-zoom-in overflow-hidden rounded-item align-top outline-none"
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
          className="block max-h-80 max-w-full object-contain"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="xl" className="h-[min(80vh,900px)] w-[min(92vw,1200px)] max-w-none bg-shell p-3">
          <DialogTitle className="sr-only">{alt || t('kit.markdown.image.open')}</DialogTitle>
          <DialogDescription className="sr-only">{t('kit.zoomPan.roleDescription')}</DialogDescription>
          <ZoomPan label={alt || t('kit.markdown.image.open')} className="h-full w-full">
            <img src={src} alt={alt} draggable={false} className="block max-h-full max-w-full object-contain" />
          </ZoomPan>
        </DialogContent>
      </Dialog>
    </>
  )
}
