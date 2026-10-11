import { fireEvent } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installInputModality } from './inputModality'

it('switches modality before controls react and releases listeners on cleanup', () => {
  const dispose = installInputModality()
  fireEvent.keyDown(document, { key: 'Tab' })
  expect(document.documentElement.dataset.input).toBe('keyboard')
  fireEvent.pointerDown(document)
  expect(document.documentElement.dataset.input).toBe('pointer')
  fireEvent.keyDown(document, { key: 'Shift' })
  expect(document.documentElement.dataset.input).toBe('pointer')
  fireEvent.keyDown(document, { key: 'a' })
  expect(document.documentElement.dataset.input).toBe('keyboard')
  // Moving the mouse is enough to get hover feedback back; no click required.
  fireEvent.pointerMove(document)
  expect(document.documentElement.dataset.input).toBe('pointer')
  dispose()
  fireEvent.keyDown(document, { key: 'Enter' })
  expect(document.documentElement.dataset.input).toBeUndefined()
})

it('marks Tab navigation separately, so typing into a clicked field never counts as keyboard focus', () => {
  const dispose = installInputModality()
  const root = document.documentElement
  fireEvent.pointerDown(document)
  fireEvent.keyDown(document, { key: 'a' })
  expect(root.dataset.input).toBe('keyboard')
  expect(root.dataset.focusNav).toBe('pointer')
  fireEvent.keyDown(document, { key: 'Tab' })
  expect(root.dataset.focusNav).toBe('keyboard')
  // Only a click hands focus back to the pointer; moving the mouse leaves a tabbed-to field marked.
  fireEvent.pointerMove(document)
  expect(root.dataset.focusNav).toBe('keyboard')
  fireEvent.pointerDown(document)
  expect(root.dataset.focusNav).toBe('pointer')
  dispose()
  expect(root.dataset.focusNav).toBeUndefined()
})

it('keeps focus rings off until the first real key press', () => {
  const root = document.documentElement
  root.dataset.pristine = ''
  const dispose = installInputModality()
  fireEvent.pointerDown(document)
  fireEvent.keyDown(document, { key: 'Meta' })
  expect(root.dataset.pristine).toBe('')
  fireEvent.keyDown(document, { key: 'Tab' })
  expect(root.dataset.pristine).toBeUndefined()
  dispose()
})
