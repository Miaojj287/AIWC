/**
 * agent (composer extras) — attachments and the send queue of the
 * Agent composer (src/features/agent/composer). Spread into the `agent` namespace; split out to keep agent.ts small.
 */
export const agentComposer = {
  attachments: {
    label: '附件',
    image: '图片',
    remove: '移除 {name}',
    pick: '上传图片或文件',
    pickDescription: '也可以直接粘贴截图，或拖进输入框',
    pastedName: '粘贴的文本 {n}.txt',
    pastedMeta: '{chars} 字 · {lines} 行',
    noVision: '{model} 不支持图片输入，图片会以文字说明代替',
    dropHint: '松开以添加附件',
    error: {
      tooMany: '一条消息最多 {max} 个附件',
      imageTooLarge: '「{name}」超过 {max}，图片不能大于 {max}',
      fileTooLarge: '「{name}」超过 {max}，文件不能大于 {max}',
      totalTooLarge: '附件合计不能超过 {max}',
      unsupportedType: '「{name}」的图片格式不支持，请用 PNG、JPEG、GIF 或 WebP',
      readFailed: '读取「{name}」失败',
    },
  },
  /** Messages queued while a turn runs, sent one per turn when it ends (queuedInputs.ts). */
  queue: {
    add: '排队，本轮结束后发送',
    label: '排队的消息',
    title: '{n} 条排队消息',
    paused: '本轮已停止，排队的消息暂不发送',
    sendNow: '立即发送',
    edit: '放回输入框编辑',
    remove: '移除',
    attachments: '{n} 个附件',
  },
}
