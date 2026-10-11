import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { __resetLanguageForTests, setLanguage } from '@/i18n'
import { Lightbox } from './Lightbox'

afterEach(() => {
  cleanup()
  __resetLanguageForTests()
})

describe('Lightbox', () => {
  it('plays a video by its kind, whatever the alt text says', () => {
    setLanguage('en-US')
    render(<Lightbox item={{ src: 'aiwc-media://clip.mp4', alt: 'anything', kind: 'video' }} onClose={() => {}} />)
    expect(document.querySelector('video')).not.toBeNull()
    expect(document.querySelector('img')).toBeNull()
  })

  it('shows a still image when the kind is image, even with the video label', () => {
    render(<Lightbox item={{ src: 'aiwc-media://poster.jpg', alt: '视频', kind: 'image' }} onClose={() => {}} />)
    expect(document.querySelector('video')).toBeNull()
    expect(document.querySelector('img')).not.toBeNull()
  })
})
