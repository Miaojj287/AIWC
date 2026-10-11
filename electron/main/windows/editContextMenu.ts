/**
 * Native right-click menu for text: Undo / Redo / Cut / Copy / Paste / Select All in any editable field, Copy for a
 * text selection elsewhere. The app's own object menus (sessions, tabs, messages) are Radix menus that cancel the DOM
 * `contextmenu` event, so Electron never reports those; what reaches this module is exactly the text every native
 * macOS / Windows field gives a menu to. Pure template builder: the caller pops it up.
 */
import type { MenuItemConstructorOptions } from 'electron'

export interface EditContextParams {
  isEditable: boolean
  selectionText: string
  editFlags: {
    canUndo: boolean
    canRedo: boolean
    canCut: boolean
    canCopy: boolean
    canPaste: boolean
    canSelectAll: boolean
  }
}

export interface EditMenuLabels {
  undo: string
  redo: string
  cut: string
  copy: string
  paste: string
  selectAll: string
}

export function editContextMenuTemplate(
  params: EditContextParams,
  labels: EditMenuLabels,
): MenuItemConstructorOptions[] | undefined {
  const { editFlags: flags } = params
  if (params.isEditable) {
    return [
      { role: 'undo', label: labels.undo, enabled: flags.canUndo },
      { role: 'redo', label: labels.redo, enabled: flags.canRedo },
      { type: 'separator' },
      { role: 'cut', label: labels.cut, enabled: flags.canCut },
      { role: 'copy', label: labels.copy, enabled: flags.canCopy },
      { role: 'paste', label: labels.paste, enabled: flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: labels.selectAll, enabled: flags.canSelectAll },
    ]
  }
  if (params.selectionText.trim().length > 0) {
    return [{ role: 'copy', label: labels.copy, enabled: flags.canCopy }]
  }
  return undefined
}
