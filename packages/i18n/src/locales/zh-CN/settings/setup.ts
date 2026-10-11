/** settings.setup — 首次引导的「接入模型」一步 (ModelSetupStep, rendered inside the onboarding wizard). */
export const setup = {
  title: '接入一个模型',
  description: 'Agent、自动回复和克隆都靠模型工作。选一个服务商，或用本机的 Ollama。',
  vendorsLabel: '模型服务商',
  connected: '已接入 {label} · {n} 个模型',
  connectedHint: '可以继续接入其他服务商，或直接完成。',
  testing: '正在测试连接…',
  testOk: '连接正常 · {ms} 毫秒',
  testFailed: '连接失败：{message}',
  retest: '重新测试',
  finish: '完成',
  skip: '稍后再说',
  skipNote: '不接入模型也能浏览聊天记录；Agent、自动回复和克隆要等接入后才能用，随时可在「设置 › AI 接入」配置。',
  back: '上一步',
  local: '本地',
  connectedBadge: '已接入',
}
