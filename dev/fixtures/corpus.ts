/**
 * Text material for the demo dataset generator. Everything here is invented; none of the names or
 * group titles come from the Figma mock (CLAUDE.md §7).
 */

export const SURNAMES = [
  '赵', '钱', '孙', '周', '吴', '郑', '冯', '陈', '卫', '蒋', '沈', '韩', '杨', '朱', '秦', '许', '何', '吕',
  '施', '孔', '曹', '严', '华', '金', '魏', '陶', '姜', '谢', '邹', '柏', '章', '苏', '潘', '葛', '范', '彭',
  '鲁', '韦', '马', '苗', '方', '任', '袁', '柳', '唐', '罗', '梁', '宋', '叶', '余', '杜', '夏', '田', '石',
  '姚', '邱', '汪', '崔', '贺', '龚', '林', '徐', '郭', '黄', '高', '李', '王', '张',
] as const

export const GIVEN_NAMES = [
  '思远', '雨桐', '子墨', '佳怡', '浩然', '欣然', '梓萱', '文博', '嘉豪', '婉婷', '志强', '晓东', '美玲', '建国',
  '秀英', '俊杰', '芷若', '若曦', '天宇', '星辰', '语嫣', '泽楷', '佩珊', '家豪', '淑芬', '国庆', '海燕', '慧敏',
  '立群', '春梅', '云飞', '忆南', '静怡', '鹏飞', '亦菲', '承泽', '文轩', '诗涵', '沐阳', '一诺', '可欣', '瑞霖',
  '昕怡', '洛白', '景行', '知夏', '书瑶', '逸尘', '明轩', '雅琴', '志远', '晨曦', '若男', '德华', '婧', '磐', '珂',
  '航', '澄', '桉', '楠', '越', '珞', '岚', '翊', '珩', '苒', '桐', '禾',
] as const

/** Full names that must never be produced (they appear in the design mock). */
export const FORBIDDEN_NAMES = new Set(['李娜', '张明', '王伟'])

export const SELF_NICKNAMES = ['阿禾', '小澄同学', '一颗桉树', 'Yijun', '越越', '珂珂不加糖'] as const

export const HANDLES = [
  'moonlight', 'coffee_addict', 'runner', 'k_yu', 'sunny', 'hikaru', 'mizu', 'leo', 'nova', 'echo', 'pine',
  'river', 'sail', 'lumen', 'orbit', 'fern', 'cobalt', 'maple', 'drift', 'quill',
] as const

export const REMARK_PATTERNS = [
  (s: string, _g: string) => `${s}姐`,
  (s: string, _g: string) => `老${s}`,
  (s: string, _g: string) => `${s}总`,
  (s: string, g: string) => `小${g.slice(-1)}`,
  (s: string, g: string) => `${s}${g}（同事）`,
  (s: string, g: string) => `${s}${g} 房东`,
  (s: string, g: string) => `${s}${g}-供应商`,
  (s: string, g: string) => `${g}（高中）`,
  (s: string, _g: string) => `${s}老师`,
] as const

export interface GroupTemplate {
  title: string
  /** work groups talk on weekdays 9–19; social groups in the evening / weekend */
  flavor: 'work' | 'social' | 'family'
}

export const GROUP_TEMPLATES: readonly GroupTemplate[] = [
  { title: '前端小组', flavor: 'work' },
  { title: '客户成功 · 华东', flavor: 'work' },
  { title: 'Q3 项目冲刺群', flavor: 'work' },
  { title: '供应商对接（勿外传）', flavor: 'work' },
  { title: '设计评审｜周三', flavor: 'work' },
  { title: '新办公室搬迁筹备', flavor: 'work' },
  { title: '数据平台需求池', flavor: 'work' },
  { title: '周五晚羽毛球', flavor: 'social' },
  { title: '川渝火锅爱好者', flavor: 'social' },
  { title: '2016 级 3 班', flavor: 'social' },
  { title: '跑步打卡 · 不许偷懒', flavor: 'social' },
  { title: '楼下拼咖啡', flavor: 'social' },
  { title: '读书会 · 每月一本', flavor: 'social' },
  { title: '一家人', flavor: 'family' },
  { title: 'A 座业主交流群', flavor: 'family' },
  { title: '露营装备交流', flavor: 'social' },
]

/** Short acknowledgements that end or punctuate a conversation. */
export const ACKS = [
  '好的', '收到', '嗯嗯', '哈哈哈', '可以', '行', 'OK', '没问题', '稍等', '在的', '好，晚点说', '了解', '明白了',
  '👌', '辛苦了', '谢谢！', '哈哈', '对的', '嗯', '知道了', '好呀', '走起', '牛', '666', '嘿嘿', '成',
] as const

export const QUESTIONS = [
  '你那边现在方便说话吗？', '这个周末有安排吗？', '上次说的那个文件发我一下？', '今晚几点结束？', '你看到群里消息了吗',
  '这个要怎么弄？', '你们几点到？', '还有多久？', '要不要我帮你带一份？', '这个价格能再谈吗？', '会议改到几点了？',
  '你昨天说的那家店叫什么？', '周报写了吗', '有推荐的耳机吗，一千以内', '明天下雨吗', '那个 bug 修了没',
] as const

export const STATEMENTS = [
  '刚开完会，晚点回你', '路上堵得厉害，可能晚十分钟', '这个方案我觉得可以先试一版', '今天太累了，明天再说吧',
  '刚看到，稍等我确认一下', '我把链接发你', '晚饭吃了没', '外面下雨了，记得带伞', '刚才电话没接到，什么事',
  '这周的数据我拉出来了，比上周涨了一点', '先这样，有问题随时说', '我到了，在门口等你', '文件太大了，我传网盘',
  '早啊', '晚安', '下班了没', '我先睡了，明天聊', '好久不见！最近怎么样', '你说的那本书我买了', '这周五约饭？',
  '下午三点的会记得参加', '刚把合同签回去了', '快递到了，放前台了', '这个我来跟进', '版本已经发了，帮忙看看',
  '预算那边卡住了，等财务回复', '今天地铁人好多', '中午吃什么', '给你看个好玩的', '我这边网不太好，可能会掉',
  '这个需求先放到下个迭代吧', '上周的复盘我整理成文档了', '这两天忙着搬家，回复慢', '收到货了，包装挺好的',
  '我看了一下，应该是配置的问题', '要不我们线下聊一下，打字太慢', '晚上一起吃饭吗，我请', '刚从机场出来',
  '这个价格我再确认一下给你回复', '刚给你转了，看一下', '等我十分钟', '今天的例会取消了', '我去接孩子，稍晚回',
] as const

export const LINK_TITLES = [
  '2026 年下半年行业观察：从工具到工作台', '一份关于远程协作的长文', '这家新开的日料店评价挺高', '周末去哪儿：市郊三条徒步线路',
  '产品经理如何写好一份 PRD', '为什么你的睡眠总是不够', 'SQLite 全文检索实践笔记', '成都周边露营地推荐',
] as const

export const FILE_NAMES = [
  '需求文档_v3.docx', '报价单-0812.xlsx', '合同扫描件.pdf', '会议纪要-0903.md', '海报终稿.png', '排期表.xlsx',
  '发票合并.pdf', '用户访谈记录.docx', '接口说明_v2.pdf', '预算明细.xlsx', '活动流程.pptx', 'IMG_2043.jpg',
] as const

/**
 * Two-party scripts. Odd lines are spoken by the opener, even lines by the other party; speaker
 * roles are randomly assigned to "me" / "peer" per conversation.
 */
export const DM_SCRIPTS: readonly (readonly string[])[] = [
  ['明天下午有空吗？想约你聊聊那个方案', '有的，三点以后都行', '那三点半，老地方咖啡店？', '行，我提前到', '带上上次的资料', '好，我打印一份'],
  ['你上周说的那个课，链接发我一下', '稍等，我找找', '不急', '找到了，我发你邮箱了', '收到，谢啦', '记得早点报名，好像限人数'],
  ['今晚吃什么', '想吃火锅', '又火锅？', '那你说', '楼下新开了一家湘菜', '行，七点见'],
  ['刚看到你发的照片，是在哪拍的', '西山那边，上周六去的', '风景不错啊', '人也不多，下次一起', '好啊，等天凉一点'],
  ['帮我看下这个报错是什么意思', '截图发我', '发了', '你环境变量没配', '哦哦，我试试', '好了吗', '好了好了，谢谢'],
  ['我到楼下了', '等我两分钟，在拿快递', '不急', '来了来了'],
  ['房租下个月能不能晚几天', '可以，月十号之前就行', '好的，谢谢理解', '客气'],
  ['周报我先发你看看', '好，我下午看', '主要是第二部分不太确定', '看了，第二部分改成按项目列比较清楚', '明白，我改一下'],
  ['妈，我周末回家吃饭', '好啊，想吃什么', '你做的红烧肉', '行，我提前去买', '别太累了', '不累，你早点回来'],
  ['那个合同的事怎么样了', '法务还在看，估计周三能回', '好，有消息告诉我', '嗯'],
  ['我把机票订了，周五晚上八点的', '那几点到', '十一点多', '我去接你', '太晚了，不用', '没事，反正睡不着'],
  ['最近在看什么书', '在看一本讲睡眠的，还挺有意思', '书名是什么', '《我们为什么要睡觉》', '我也去买一本'],
  ['你那边的数据什么时候能给我', '今天下班前', '好，我等着排版', '拉好了，发你了', '收到'],
  ['这周跑步打卡了几次', '两次，惭愧', '我一次都没', '哈哈哈那我比你强', '周末补上'],
  ['明天的会我可能要迟到一点', '没事，我先讲前面的部分', '谢了，大概晚十分钟', '行'],
  ['孩子学校那边通知周五开家长会', '我这边有个会，你能去吗', '我调一下时间', '辛苦'],
  ['刚给你转了这个月的水电费', '收到了', '下个月应该会少一点，我把空调时间调了', '好'],
  ['方案里那个价格能再降一点吗', '幅度不大，最多五个点', '那先按这个来吧', '好，我更新一版发你'],
  ['我今天路过你们公司楼下了', '怎么不上来', '赶时间，下次', '下次请你喝咖啡'],
  ['上次说的那个耳机你买了吗', '买了，还不错', '降噪怎么样', '地铁上够用', '那我也整一个'],
  ['体检报告出来了', '怎么样', '都正常，就是要少熬夜', '哈哈那你听劝', '尽量'],
  ['下周三的评审你参加吗', '参加，需要我准备什么', '把你那部分的进度讲一下就行', '好'],
  ['我下午请假去修车', '好，有事我找你', '嗯，微信随时在'],
  ['这个 UI 你觉得怎么样', '整体不错，颜色有点重', '我调淡一点', '对，可以对比一下'],
]

/** Group scripts: `speaker` is a role index (0..N-1), mapped to random members at runtime. */
export interface GroupLine {
  speaker: number
  text: string
}

export const GROUP_SCRIPTS: Record<GroupTemplate['flavor'], readonly (readonly GroupLine[])[]> = {
  work: [
    [
      { speaker: 0, text: '各位，明天上午十点评审，材料今天下班前发我' },
      { speaker: 1, text: '收到' },
      { speaker: 2, text: '我的部分还差一点，晚上补完' },
      { speaker: 0, text: '可以，别太晚' },
      { speaker: 3, text: '会议室订了吗' },
      { speaker: 0, text: '订了 3 楼的' },
    ],
    [
      { speaker: 1, text: '线上有个报错，看起来是昨晚发布引入的' },
      { speaker: 2, text: '我看一下日志' },
      { speaker: 2, text: '找到了，是缓存 key 没带版本号' },
      { speaker: 0, text: '能先回滚吗' },
      { speaker: 2, text: '已经回滚了，修复晚点再发' },
      { speaker: 1, text: '辛苦' },
    ],
    [
      { speaker: 3, text: '这周的排期表我更新了，大家看一眼有没有冲突' },
      { speaker: 4, text: '我周四要出差，那天的排到周五可以吗' },
      { speaker: 3, text: '可以' },
      { speaker: 0, text: '其他人没问题的话就这么定' },
      { speaker: 1, text: '没问题' },
    ],
    [
      { speaker: 0, text: '客户反馈导出功能有点慢，有人跟一下吗' },
      { speaker: 2, text: '我来' },
      { speaker: 2, text: '数据量大的时候确实要十几秒，我加个异步' },
      { speaker: 0, text: '好，做完发个说明' },
    ],
    [
      { speaker: 4, text: '午饭一起？' },
      { speaker: 1, text: '走' },
      { speaker: 3, text: '我带饭了，你们去吧' },
      { speaker: 4, text: '那我们十二点楼下集合' },
    ],
    [
      { speaker: 0, text: '提醒一下，报销截止是本周五' },
      { speaker: 2, text: '收到' },
      { speaker: 3, text: '发票还没开出来，能晚几天吗' },
      { speaker: 0, text: '财务说最多到下周一' },
    ],
    [
      { speaker: 1, text: '新版设计稿在群文件里了，大家有空看一下' },
      { speaker: 4, text: '看了，列表页的间距是不是有点紧' },
      { speaker: 1, text: '我再调一下' },
      { speaker: 0, text: '整体方向没问题' },
    ],
  ],
  social: [
    [
      { speaker: 0, text: '周五晚上老时间，有人来吗' },
      { speaker: 1, text: '来' },
      { speaker: 2, text: '+1' },
      { speaker: 3, text: '我可能晚到半小时' },
      { speaker: 0, text: '行，先打着' },
    ],
    [
      { speaker: 2, text: '周末去露营的报个名，目前四个人' },
      { speaker: 4, text: '我要去，带什么' },
      { speaker: 2, text: '帐篷够了，你带点吃的' },
      { speaker: 1, text: '我带咖啡壶' },
      { speaker: 0, text: '完美' },
    ],
    [
      { speaker: 3, text: '今天打卡 5 公里，累死' },
      { speaker: 1, text: '牛' },
      { speaker: 0, text: '我明早跑' },
      { speaker: 4, text: '你上周也这么说' },
      { speaker: 0, text: '这次真的' },
    ],
    [
      { speaker: 1, text: '这个月的书大家读到哪了' },
      { speaker: 2, text: '刚过一半，写得挺好' },
      { speaker: 0, text: '我还没开始，惭愧' },
      { speaker: 1, text: '月底分享会别忘了' },
    ],
    [
      { speaker: 4, text: '楼下咖啡店今天第二杯半价，有人拼吗' },
      { speaker: 0, text: '拼，冰美式' },
      { speaker: 3, text: '拿铁一杯' },
      { speaker: 4, text: '十分钟后取' },
    ],
    [
      { speaker: 0, text: '好久没聚了，国庆前搞一次？' },
      { speaker: 2, text: '可以，地点定了说' },
      { speaker: 1, text: '别选太远的' },
      { speaker: 3, text: '市中心那家火锅怎么样' },
      { speaker: 0, text: '就它了' },
    ],
  ],
  family: [
    [
      { speaker: 0, text: '周末回来吃饭吗' },
      { speaker: 1, text: '回，周六中午到' },
      { speaker: 2, text: '我买了排骨' },
      { speaker: 1, text: '想吃糖醋的' },
      { speaker: 2, text: '好' },
    ],
    [
      { speaker: 3, text: '小区停水通知，明天上午九点到下午三点' },
      { speaker: 0, text: '收到，晚上先存点水' },
      { speaker: 2, text: '谢谢提醒' },
    ],
    [
      { speaker: 1, text: '给你们发了几张照片，上周去公园拍的' },
      { speaker: 0, text: '拍得好' },
      { speaker: 2, text: '天气不错' },
    ],
    [
      { speaker: 4, text: '楼上装修太吵了，有人知道到几点吗' },
      { speaker: 3, text: '物业说工作日六点前' },
      { speaker: 4, text: '好的' },
    ],
  ],
}

export const CLONE_TONES = ['直接', '温和', '爱开玩笑', '简短', '细致', '热情', '偶尔吐槽', '务实'] as const
export const CLONE_TRAITS = ['回消息快', '喜欢用表情', '习惯先给结论', '会主动关心', '不喜欢打电话', '爱分享链接'] as const
