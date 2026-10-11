/** settings.network — 设置 › AI 接入 › 网络 (NetworkSection): proxy for requests to model providers. */
export const network = {
  section: '网络',
  help: '只影响发往模型服务商的请求。Ollama、localhost 等本机地址始终直连。',
  mode: {
    title: '代理',
    system: '跟随系统',
    manual: '手动',
    off: '不使用',
  },
  url: {
    title: '代理地址',
    placeholder: 'http://127.0.0.1:7890',
    errors: {
      empty: '请填写代理地址',
      invalid: '地址格式不对，例如 http://127.0.0.1:7890',
      scheme: '只支持 http、https、socks5',
      credentials: '用户名和密码请填在「代理认证」里',
      port: '端口应在 1–65535 之间',
    },
  },
  auth: {
    title: '代理认证',
    description: '可选；密码只保存在本机钥匙串',
    username: '用户名',
    password: '密码',
    passwordSaved: '已保存，留空不修改',
    clearPassword: '清除密码',
    passwordCleared: '已清除代理密码',
  },
  bypass: {
    title: '不走代理的地址',
    help: '每行一个，或用逗号分隔。支持 example.com、*.example.com、.example.com、host:端口、10.0.0.0/8 和 <local>（不带点的主机名）。',
    placeholder: '*.example.com\n10.0.0.0/8',
  },
  saved: '网络设置已保存',
  test: {
    button: '测试代理',
    okProxy: '经 {proxy} 连通 · {ms} 毫秒',
    okDirect: '直连连通 · {ms} 毫秒',
    failed: '连接失败',
    errors: {
      proxy_invalid: '代理地址无效',
      timeout: '连接超时',
      network: '无法连接到服务商',
    },
  },
}
