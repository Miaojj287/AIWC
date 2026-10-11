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
  /** Why 保存 is disabled. */
  nothingToSave: '没有未保存的修改',
  reveal: '在文件夹中显示',
  quoteSelection: '引用到 Agent',
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
  openExternally: '用默认应用打开',
  /** Noun for the "couldn't open …" toast. */
  openTarget: '文件',
  zoom: {
    in: '放大',
    out: '缩小',
    fit: '适合宽度',
    min: '已是最小',
    max: '已是最大',
    isFit: '已经适合宽度',
  },
  pdf: {
    pages: '共 {n} 页',
    pagesCapped: '共 {n} 页，预览前 {shown} 页',
    page: '第 {n} 页',
    pageFailed: '第 {n} 页无法显示',
    failed: '无法打开这个 PDF',
  },
  table: {
    truncated: '只显示前 {n} 行，完整内容请用默认应用打开',
  },
  html: {},
  media: {
    failed: '无法播放这个文件',
    failedHint: '格式可能不受支持，可以用默认应用打开',
  },
  docx: {
    image: '图片（预览中不显示）',
    truncated: '文档较长，只显示前面的部分',
  },
  xlsx: {
    sheet: '工作表',
    emptySheet: '这个工作表是空的',
  },
}
