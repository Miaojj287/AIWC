/**
 * Mirror the window's focus on <html data-window-focus>. Native tables and sidebars grey their selection while their
 * window is inactive; tokens.css does the same for `--selected-bg` / `--selected-ring`, so the app never looks like
 * it still has the user's attention when another window does.
 */
export function installWindowFocus(): () => void {
  const root = document.documentElement
  const update = () => {
    root.dataset.windowFocus = document.hasFocus() ? 'true' : 'false'
  }
  update()
  window.addEventListener('focus', update)
  window.addEventListener('blur', update)
  return () => {
    window.removeEventListener('focus', update)
    window.removeEventListener('blur', update)
    delete root.dataset.windowFocus
  }
}
