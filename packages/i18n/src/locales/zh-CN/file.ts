/** file — the 文件 Tab (src/features/file): Markdown editor / preview toolbar, states, status bar. */
export const file = {
  view: {
    label: '视图',
    split: '分栏',
    preview: '预览',
  },
  saved: '已保存 {name}',
  saveFailed: '保存失败：{detail}',
  revealFailed: '无法打开所在文件夹：{detail}',
  dirty: '已修改 · 未保存',
  reveal: '在文件夹中显示',
  loading: '正在读取文件…',
  loadFailed: '无法读取文件',
  editorLabel: 'Markdown 编辑器',
  /** Status bar: `n` picks the plural, `count` is the formatted number. */
  chars: '{n, plural, other {{count} 字}}',
  lines: '{n, plural, other {{count} 行}}',
  emptyFile: '空文件',
  emptyFileHint: '在左侧开始输入，这里会实时预览',
  unsupported: '暂不支持预览此类型',
  unknownType: '未知类型',
  markdown: {
    /** Noun for the "couldn't open …" toast. */
    link: '链接',
  },
}
