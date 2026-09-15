/** settings.nav — the Tab shell: SettingsNav, SettingsTab, page meta (model.ts), search index rows, pageKit, hooks toasts, CloseRequestDialog. */
export const nav = {
  tabTitle: '设置',
  ariaLabel: '设置导航',
  pages: {
    general: { label: '常规', title: '常规', description: '外观与启动行为' },
    account: { label: '账号', title: '账号管理', description: '微信账号、数据库与解密密钥' },
    ai: { label: 'AI 接入', title: 'AI 接入', description: 'Agent 模型与语音转写' },
    pets: { label: '宠物', title: '宠物', description: '陪你用 Agent 的小伙伴：思考时跑、等你确认时招手、完成后庆祝' },
    memory: { label: '记忆', title: 'AI 记忆', description: 'Agent 跨会话记住的事实与规则，均为本地 Markdown 文件' },
    about: { label: '版本与支持', title: '版本与支持', description: '版本信息、协议与日志' },
  },
  groups: { common: '通用', ai: 'AI', about: '关于' },
  account: { loading: '读取账号…', disconnected: '未连接账号', configureHint: '在「账号」中配置' },
  search: {
    placeholder: '搜索设置',
    results: '匹配的设置项',
    count: '{n} 个匹配',
    empty: '没有找到相关设置',
    emptyHint: '换个关键词试试，例如「密钥」「模型」「记忆」',
    /** Section labels shown in a hit's location that have no catalog key on their page. */
    groups: {
      currentAccount: '当前账号',
      editor: '编辑',
      version: '版本',
    },
    /**
     * One entry per searchable row, keyed by the row id (`general.theme` → rows.general.theme).
     * `keywords` are comma-separated search synonyms; search matches every language's copy.
     */
    rows: {
      general: {
        appearance: {
          title: '自定义配色',
          description: '强调色、背景、前景、字体与对比度',
          keywords: '强调色, 背景, 前景, 字体, 对比度, 配色',
        },
        theme: {
          title: '主题模式',
          description: '跟随系统 / 浅色 / 深色',
          keywords: 'theme, 深色, 浅色, 跟随系统, 外观',
        },
        transparency: {
          title: '透明效果',
          description: '功能栏与列表透出桌面背景',
          keywords: '透明, 毛玻璃, 半透明, glass, vibrancy, acrylic, blur',
        },
        language: {
          title: '界面语言',
          description: '简体中文 / English',
          keywords: 'language, i18n, english, chinese, 语言, 中文, 英文',
        },
        launchAtLogin: { title: '开机自启', description: '登录后自动启动', keywords: 'launch, login, 自启动, 启动' },
        closeBehavior: {
          title: '关闭窗口时',
          description: '退出 / 最小化 / 每次询问',
          keywords: 'close, 退出, 最小化, 菜单栏, 每次询问',
        },
        layout: {
          title: '默认界面',
          description: '工作台 / Agent 窗口',
          keywords: 'layout, agent window, workbench, 布局, 模式, 工作台, Agent 窗口',
        },
      },
      account: {
        current: {
          title: '切换账号',
          description: '本机检测到的所有 wxid 及验证状态',
          keywords: 'wxid, account, 账号, 重新扫描',
        },
        dbKey: {
          title: '数据库解密密钥',
          description: '64 位十六进制，可自动获取',
          keywords: 'key, 密钥, hex, 自动获取, 手动输入',
        },
        dbRoot: {
          title: '数据库根目录',
          description: '包含 db_storage 的微信数据目录',
          keywords: 'path, db_storage, 目录, 路径',
        },
        verify: { title: '账号验证', description: '确认 wxid 与目录匹配', keywords: 'verify, 验证, 测试连接' },
        cacheDir: { title: '缓存目录', description: '留空使用默认目录', keywords: 'cache, 缓存, 目录' },
        imageKeys: {
          title: '图片解密密钥',
          description: 'XOR / AES 密钥，可自动获取',
          keywords: 'xor, aes, image, 图片, 密钥',
        },
      },
      pets: {
        current: {
          title: '当前宠物',
          description: '预览动作，查看来源',
          keywords: '宠物, pet, pets, codex pets, 伙伴, 桌宠, 小动物',
        },
        enabled: {
          title: '在 Agent 面板显示宠物',
          description: '宠物站在输入框上方，跟着 Agent 的状态切换动作',
          keywords: '宠物, 显示, 隐藏, pet',
        },
        bubbles: {
          title: '状态气泡',
          description: '等你确认、完成或出错时在宠物旁提示一句话',
          keywords: '宠物, 气泡, 提示, 通知',
        },
        motion: { title: '宠物动画', description: '关闭后保持静止姿势', keywords: '宠物, 动画, 动态, 减少动态效果' },
        idleFlair: { title: '闲时小动作', description: '空闲时偶尔挥手、跳一跳', keywords: '宠物, 小动作, 挥手, 空闲' },
        size: { title: '宠物大小', description: '小 / 中 / 大', keywords: '宠物, 大小, 尺寸' },
        installed: {
          title: '我的宠物',
          description: '选用、删除，或导入下载好的宠物压缩包',
          keywords: '宠物, 导入, zip, 压缩包, 删除, 选用',
        },
        catalog: {
          title: '宠物图库',
          description: '浏览 codex-pets.net 社区宠物并领养',
          keywords: '宠物, 图库, 领养, 下载, codex-pets, gallery',
        },
      },
      ai: {
        providers: {
          title: '模型厂商',
          description: 'DeepSeek / Kimi / GLM / Qwen / OpenAI / Anthropic / Ollama 等，或自定义接口',
          keywords:
            'provider, vendor, deepseek, kimi, glm, qwen, minimax, hunyuan, openai, anthropic, gemini, ollama, 厂商, 接入, 自定义',
        },
        apiKey: {
          title: 'API Key',
          description: '只保存在本机钥匙串',
          keywords: 'key, api key, 密钥, token, 编辑 key',
        },
        models: {
          title: '模型列表',
          description: '启用 / 停用、推理强度、快速模式',
          keywords: 'model, 模型, 启用, 推理强度, 快速, 上下文, 拉取模型',
        },
        status: {
          title: '测试连接',
          description: '延迟与工具调用支持',
          keywords: 'test, status, 测试连接, 连接, 断开',
        },
        defaultModel: { title: '默认模型', description: '新会话默认使用', keywords: 'default, model, 默认' },
        sttMode: { title: '转写模式', description: '本地 / 在线', keywords: 'stt, whisper, 语音, 转文字, 本地, 在线' },
        sttLocal: {
          title: '本地模型',
          description: '下载、删除与设为默认',
          keywords: 'stt, 语音, 本地模型, 下载, 训练参数',
        },
        sttOnline: {
          title: '在线转写接口',
          description: '提供商、URL、Key、模型 ID',
          keywords: 'stt, 在线, 转写, 接口, transcription',
        },
      },
      memory: {
        files: {
          title: '记忆文件',
          description: 'MEMORY / USER / SOUL / AGENTS 四个 Markdown 文件',
          keywords: 'memory, markdown, 记忆, 画像, 人格, 规则',
        },
        editor: {
          title: '编辑记忆文件',
          description: '内嵌 Markdown 编辑器，保存或重置',
          keywords: 'edit, 编辑, 保存, 重置',
        },
        autoWrite: {
          title: '自动写入记忆',
          description: '会话结束时提炼要点写入 MEMORY.md',
          keywords: 'auto, 自动写入, 策略',
        },
        confirmBeforeWrite: {
          title: '写入前需要确认',
          description: '关闭后 Agent 可直接修改记忆文件',
          keywords: 'confirm, 确认, 策略',
        },
        maxEntries: { title: '记忆条数上限', description: '超出后按最久未使用淘汰', keywords: 'limit, 上限, 条数' },
        clear: { title: '清空全部记忆', description: '其他记忆文件不受影响', keywords: 'clear, 清空, 删除' },
      },
      about: {
        update: { title: '检查更新', description: '版本与更新', keywords: 'update, 更新, 版本' },
        terms: { title: '用户服务协议', description: '协议全文', keywords: 'terms, 协议' },
        privacy: { title: '隐私政策', description: '政策全文', keywords: 'privacy, 隐私' },
        logs: { title: '日志', description: '导出日志，不含聊天内容', keywords: 'log, 日志, 导出' },
      },
    },
  },
  unsaved: {
    title: '放弃未保存的修改？',
    description: '「{page}」里有还没保存的修改，离开后这些修改会丢失。',
    confirm: '放弃修改并离开',
    cancel: '继续编辑',
  },
  config: { saveFailed: '保存设置失败', loadFailed: '读取配置失败' },
  closeDialog: {
    title: '关闭 AIWC？',
    description: '关闭后，自动回复与推送将停止',
    behavior: '关闭方式',
    minimize: '最小化到菜单栏，后台继续运行',
    quit: '完全退出',
    remember: '记住我的选择，不再询问',
    rememberHint: '可在设置中修改',
  },
}
