/**
 * 用户服务协议 / 隐私政策 copy shown in the 版本与支持 dialogs. Product copy, not demo data.
 */
export interface LegalDoc {
  title: string
  updated: string
  sections: Array<{ heading: string; body: string }>
}

export const TERMS: LegalDoc = {
  title: 'AIWC 用户服务协议',
  updated: '2026-04-01',
  sections: [
    { heading: '1. 服务说明', body: 'AIWC 是运行在你本机的微信数据管理工具。所有解析、索引与转写均在本地完成；只有在你配置了在线模型服务商时，相关内容才会发送给该服务商。' },
    { heading: '2. 数据与隐私', body: '我们不收集、不上传你的聊天数据。当你使用第三方模型时，相关请求由你的设备直接发送到该服务商，受其隐私政策约束。' },
    { heading: '3. 授权范围', body: '你仅可对本人合法持有的微信账号数据使用本软件；不得用于监控他人、批量营销或任何违反法律法规的用途。' },
    { heading: '4. 自动回复与发送', body: '自动回复、推送等对外动作由你配置并确认；对这些消息造成的后果由你自行负责。软件提供二次确认与熔断机制，但不保证第三方平台的可用性。' },
    { heading: '5. 免责声明', body: '因使用本软件造成的数据丢失或其他损失，开发者不承担责任。建议定期备份微信数据与本软件的配置目录。' },
  ],
}

export const PRIVACY: LegalDoc = {
  title: 'AIWC 隐私政策',
  updated: '2026-04-01',
  sections: [
    { heading: '本地优先', body: '微信数据库、解密密钥、图片密钥、记忆文件与克隆画像均保存在本机应用数据目录，密钥由系统钥匙串加密存储。' },
    { heading: '发送到模型服务商的内容', body: '仅在你配置在线模型（Agent 模型、在线转写、克隆）时，被引用的聊天片段、语音文件或提炼请求会发送给你选择的服务商。使用 Ollama 等本地模型时数据不出本机。' },
    { heading: '日志', body: '日志只记录运行状态与错误，不包含聊天内容；导出日志需你手动操作。' },
    { heading: '你的控制权', body: '你可以随时在设置中删除克隆画像、清空记忆文件、移除模型服务商与密钥。卸载软件会移除全部本地数据。' },
  ],
}
