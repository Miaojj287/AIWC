/**
 * Class-name helper: clsx + tailwind-merge, with the AIWC token scales registered so that
 * `text-body` (font-size) and `text-fg` (color), or `rounded-card` vs `rounded-control`,
 * are merged as the right class groups instead of clobbering each other.
 */
import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['micro', 'note', 'caption', 'tab', 'body', 'bubble', 'title', 'wizard'],
      radius: ['window', 'card', 'item', 'control', 'chip'],
      shadow: ['overlay', 'toast'],
      font: ['sans', 'latin', 'mono'],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
