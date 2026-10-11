/**
 * Track the user's current input modality on <html data-input>. Keyboard-driven surfaces then open and close at once
 * (kit.css), while pointer work keeps its brief motion. Any pointer movement returns to `pointer`: hover feedback must
 * not depend on whether the last thing the user did was type.
 *
 * <html data-focus-nav> records how focus last moved: `keyboard` after Tab, `pointer` after a click. Text fields
 * show their accent edge only for keyboard navigation, so typing into a clicked field never lights it up.
 *
 * <html data-pristine> (set in index.html) stays until the first real key press: focus rings only appear once the user
 * has started using the keyboard, so nothing on a freshly opened window is outlined in the accent colour.
 */
export function installInputModality(): () => void {
  const root = document.documentElement
  const set = (mode: 'keyboard' | 'pointer') => {
    if (root.dataset.input !== mode) root.dataset.input = mode
  }
  const setNav = (mode: 'keyboard' | 'pointer') => {
    if (root.dataset.focusNav !== mode) root.dataset.focusNav = mode
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return
    delete root.dataset.pristine
    set('keyboard')
    if (event.key === 'Tab') setNav('keyboard')
  }
  const onPointer = () => set('pointer')
  const onPointerDown = () => {
    set('pointer')
    setNav('pointer')
  }
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointer, { capture: true, passive: true })
  return () => {
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointermove', onPointer, { capture: true })
    delete root.dataset.input
    delete root.dataset.focusNav
    // data-pristine is one-way (only a key press clears it): a remount, e.g. StrictMode's re-run, must not lose it.
  }
}
