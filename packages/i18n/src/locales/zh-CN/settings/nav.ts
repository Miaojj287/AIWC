/** settings.nav — the Tab shell: SettingsNav, SettingsTab, page meta (model.ts), search index rows, pageKit, hooks toasts, CloseRequestDialog. */
export const nav = {
  tabTitle: '设置',
  ariaLabel: '设置导航',
  pages: {
    general: { label: '常规', title: '常规' },
    account: { label: '账号', title: '账号管理' },
    data: { label: '数据', title: '本地数据' },
    ai: { label: 'AI 接入', title: 'AI 接入' },
    usage: { label: '用量与记录', title: '用量与记录' },
    pets: { label: '宠物', title: '宠物', description: '陪你用 Agent 的小伙伴，会跟着 Agent 的状态做动作' },
    memory: { label: '记忆', title: 'AI 记忆', description: 'Agent 跨会话记住的事实与规则，均为本地 Markdown 文件' },
    skills: { label: '技能', title: '技能', description: 'Agent 可以照着做的步骤：查看、启用、停用和删除' },
    todo: { label: '每日待办', title: '每日待办', description: '定时扫描所选群聊，整理摘要和待办' },
    extensions: {
      label: '扩展',
      title: '扩展',
      description: '用 MCP 服务器给 Agent 接入工具，用 Hooks 在事件发生时运行命令',
    },
    about: { label: '版本与支持', title: '版本与支持' },
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
        notifications: {
          title: '系统通知',
          description: '窗口在后台时提醒待处理的事',
          keywords: 'notification, 通知, 提醒, 横幅, 通知中心',
        },
        sendKey: {
          title: '发送消息',
          description: 'Agent 输入框按 Enter 或 ⌘/Ctrl+Enter 发送',
          keywords: 'send, enter, 回车, 换行, 快捷键, 输入框',
        },
        closeBehavior: {
          title: '关闭窗口时',
          description: '退出 / 最小化 / 每次询问',
          keywords: 'close, 退出, 最小化, 程序坞, 托盘, 每次询问',
        },
        layout: {
          title: '默认界面',
          description: '工作台 / Agent 窗口',
          keywords: 'layout, agent window, workbench, 布局, 模式, 工作台, Agent 窗口',
        },
      },
      data: {
        usage: {
          title: '占用空间',
          description: '按类别查看本地数据占用了多少磁盘',
          keywords: 'storage, disk, space, 存储, 磁盘, 空间, 占用, 缓存',
        },
        plaintext: {
          title: '明文数据库副本',
          description: '读取微信数据时生成的解密副本',
          keywords: 'plaintext, decrypted, copy, wcdb, 明文, 解密, 副本, 清除',
        },
        media: {
          title: '图片与文件缓存',
          description: '解密后的图片、视频和预览用的文件',
          keywords: 'cache, media, images, 缓存, 图片, 视频, 清理',
        },
        logs: {
          title: '旧日志',
          description: '只保留正在写入的日志',
          keywords: 'logs, 日志, 清理',
        },
        wipe: {
          title: '清除全部数据',
          description: '删除设置、密钥与所有本地数据并回到欢迎页',
          keywords: 'reset, wipe, delete all, factory, 重置, 清除, 删除全部',
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
        mobile: {
          title: '我的微信',
          description: '扫码连接自己的微信，接收定时任务推送',
          keywords: '手机, 微信, 推送, 机器人, ilink, clawbot, 扫码, 通知',
        },
        mobileRemote: {
          title: '手机遥控',
          description: '在手机微信里遥控 Agent',
          keywords: '手机, 遥控, 远程, remote, 微信, agent, 状态, 停止',
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
        statusRunning: {
          title: '运行中的会话',
          description: '宠物旁显示正在运行、等你确认的 Agent 会话数',
          keywords: '宠物, 状态, 运行, 进行中, 等待确认, 数量, running',
        },
        statusDone: {
          title: '已完成的会话',
          description: '宠物旁显示完成或出错、还没查看的会话数',
          keywords: '宠物, 状态, 完成, 出错, 未查看, done',
        },
        statusUnread: {
          title: '微信未读',
          description: '宠物旁显示微信未读消息数',
          keywords: '宠物, 未读, 消息, 微信, unread',
        },
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
        permissions: {
          title: '权限规则',
          description: '「总是允许」放行过的工具与命令，可撤销',
          keywords: 'permission, approval, grant, allow always, 权限, 总是允许, 放行, 撤销, 白名单',
        },
        jev: {
          title: 'Jev 决策模型',
          description: '自动回复「Jev（beta）」回复方式用的 TypeSafe 模型',
          keywords: 'jev, typesafe, system one, 决策, 自动回复, beta',
        },
        jevKey: {
          title: 'Jev API Key',
          description: '只保存在本机钥匙串',
          keywords: 'jev, key, api key, typesafe, 密钥',
        },
        jevTest: {
          title: 'Jev 连接状态',
          description: '测试 Key 与接口地址',
          keywords: 'jev, test, 测试连接, 接口地址, 模型',
        },
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
        proxy: {
          title: '代理',
          description: '跟随系统 / 手动 / 不使用',
          keywords: 'proxy, 代理, 网络, socks5, http, 翻墙, vpn, clash',
        },
        proxyBypass: {
          title: '不走代理的地址',
          description: '这些地址直连',
          keywords: 'bypass, no proxy, 直连, 例外, 代理',
        },
      },
      usage: {
        overview: {
          title: '用量概览',
          description: '按日期、功能、模型统计 token',
          keywords: 'usage, token, 用量, 统计, 消耗, 费用',
        },
        calls: {
          title: '调用记录',
          description: '每次模型调用的耗时与结果',
          keywords: 'log, call, 日志, 调用, 请求, 记录, 耗时',
        },
        recordContent: {
          title: '记录内容',
          description: '保存请求与回复正文，默认关闭',
          keywords: 'content, body, 正文, 请求, 回复, 记录',
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
        review: {
          title: '待确认的记忆',
          description: '提炼出的要点，确认后才写入',
          keywords: 'review, pending, 待确认, 提炼, 建议',
        },
        autoWrite: {
          title: '自动写入记忆',
          description: '对话空闲后提炼关于你的要点，确认后才写入',
          keywords: 'auto, 自动写入, 提炼, 策略',
        },
        confirmBeforeWrite: {
          title: '写入前需要确认',
          description: '开启后 Agent 记下的内容先进待确认列表',
          keywords: 'confirm, 确认, 策略',
        },
        maxEntries: {
          title: '记忆条数上限',
          description: '单个文件达到上限后，Agent 需先删除旧条目',
          keywords: 'limit, 上限, 条数',
        },
        clear: { title: '清空全部记忆', description: '其他记忆文件不受影响', keywords: 'clear, 清空, 删除' },
      },
      extensions: {
        mcp: {
          title: 'MCP 服务器',
          description: '把本地命令或远程地址的工具接给 Agent',
          keywords: 'mcp, model context protocol, 工具, 插件, server, tools, 扩展',
        },
        hooks: {
          title: 'Hooks',
          description: '在调用工具前后、提交消息或答复结束时运行命令',
          keywords: 'hook, hooks, 钩子, 命令, 脚本, 拦截, script',
        },
      },
      skills: {
        list: {
          title: '技能列表',
          description: '查看、启用、停用、删除技能，或设为定时任务',
          keywords: 'skill, skills, 技能, slash, 斜杠, 命令, SKILL.md, 定时任务',
        },
      },
      todo: {
        enabled: {
          title: '开启每日待办',
          description: '按周期扫描所选群聊，整理摘要和待办',
          keywords: 'todo, 待办, 每日, 日报, 总结, 日记, summary, daily',
        },
        sources: { title: '扫描的群聊', description: '只扫描这里选中的群聊', keywords: 'group, 群聊, 范围, 扫描' },
        maxMessages: {
          title: '每个群最多读取',
          description: '每次扫描只读每个群最新的这些消息',
          keywords: 'messages, 消息, 条数, 数量',
        },
        schedule: {
          title: '扫描周期',
          description: '每隔几小时 / 每天 / 仅手动',
          keywords: 'schedule, 周期, 频率, 每小时, 每天, 定时',
        },
        model: { title: '整理用的模型', description: '不选则用默认模型', keywords: 'model, 模型, 服务商, 本地' },
      },
      about: {
        update: { title: '检查更新', description: '版本与更新', keywords: 'update, 更新, 版本' },
        terms: { title: '用户服务协议', description: '协议全文', keywords: 'terms, 协议' },
        privacy: { title: '隐私政策', description: '政策全文', keywords: 'privacy, 隐私' },
        logs: { title: '日志', description: '导出日志，不含聊天内容，已脱敏', keywords: 'log, 日志, 导出' },
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
}
