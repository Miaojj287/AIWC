import { describe, expect, it } from 'vitest'
import { editContextMenuTemplate, type EditContextParams } from './editContextMenu'

const labels = { undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选' }
const flags = { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true }
const params = (patch: Partial<EditContextParams>): EditContextParams => ({
  isEditable: false,
  selectionText: '',
  editFlags: flags,
  ...patch,
})

describe('native text context menu', () => {
  it('gives an editable field the full edit set, honouring what the field can do right now', () => {
    const menu = editContextMenuTemplate(params({ isEditable: true }), labels)
    expect(menu?.map((item) => item.role ?? item.type)).toEqual([
      'undo',
      'redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'separator',
      'selectAll',
    ])
    expect(menu?.find((item) => item.role === 'redo')?.enabled).toBe(false)
    expect(menu?.find((item) => item.role === 'paste')?.label).toBe('粘贴')
  })

  it('offers Copy for selected read-only text and nothing for an empty click', () => {
    expect(editContextMenuTemplate(params({ selectionText: '周报' }), labels)?.map((item) => item.role)).toEqual([
      'copy',
    ])
    expect(editContextMenuTemplate(params({ selectionText: '  ' }), labels)).toBeUndefined()
  })
})
