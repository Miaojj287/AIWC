/** settings.data — 设置 › 数据 (DataPage): local disk usage per category, clearing caches, deleting everything. */
export const data = {
  sections: { usage: '占用空间', clean: '可清理的缓存', danger: '清除全部数据' },
  total: '共 {size}',
  partial: '文件太多，只统计了一部分',
  refresh: '重新统计',
  openFolder: '打开数据目录',
  loadFailed: '无法统计本地数据',
  categories: {
    index: { title: '聊天索引', description: '会话、联系人与消息的本地索引，用于搜索和 Agent 查询' },
    plaintext: { title: '明文数据库副本', description: '读取微信数据时生成的解密副本，需要时会重新生成' },
    media: { title: '图片与文件缓存', description: '解密后的图片、视频和预览用的文件，需要时会重新生成' },
    conversations: { title: 'Agent 会话', description: '与 Agent 的全部对话记录' },
    memory: { title: '记忆与 AI 克隆', description: '四个记忆文件与克隆画像' },
    features: { title: '功能记录', description: '自动回复记录、模型用量、定时任务、每日待办与通道状态' },
    skills: { title: '技能', description: '你和 Agent 添加的技能' },
    pets: { title: '宠物', description: '已领养和导入的宠物' },
    workspace: { title: 'Agent 工作区', description: 'Agent 运行命令时读写的文件夹' },
    exports: { title: '导出文件', description: '导出的聊天记录、表格与日志' },
    logs: { title: '日志', description: '运行日志，不含聊天内容' },
    other: { title: '设置与其他', description: '设置、加密的密钥库和其他文件' },
  },
  clear: {
    action: '清除',
    empty: '没有可清除的内容',
    done: '已释放 {size}',
    failed: '清理失败',
    confirm: '清除',
    plaintext: {
      title: '清除明文数据库副本？',
      description: '会短暂断开微信数据并立即重新连接，副本在下次读取时重新生成。',
    },
    media: { title: '清除图片与文件缓存？', description: '图片和文件会在下次打开时重新解密或复制。' },
    logs: { title: '清除旧日志？', description: '正在写入的日志会保留。' },
  },
  wipe: {
    title: '清除全部数据',
    description: '删除设置、密钥和全部本地数据，然后重新启动并回到欢迎页',
    action: '清除全部数据…',
    dialogTitle: '清除全部数据？',
    dialogDescription:
      '会删除设置、解密密钥、聊天索引、Agent 会话、记忆与克隆、自动回复记录等全部本地数据，无法恢复。微信自己的数据不受影响。完成后应用会重新启动。',
    /** Typed to enable the button. */
    word: '清除',
    confirm: '清除并重启',
    failed: '无法清除数据',
  },
}
