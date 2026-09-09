---
name: daily-brief
description: 生成今日早报：未回复的重要消息、今天要做的事、值得注意的人
command: /早报
tags: [brief, daily, cron]
---

# 今日早报

适合作为 cron 任务运行；无事可报时**只输出 `[SILENT]`**，不要发送空报告。

1. `list_sessions({unreadOnly: true, limit: 30})` 找到有未读的会话；对每个会话用 `get_timeline` 取最近 24 小时消息。
2. 判定「需要我回」的消息：对方最后一条是问句、@我、或包含「回复 / 确认 / 什么时候 / 麻烦」等请求词，且我方之后没有发言。
3. 用 `recall` 查记忆里今天的待办与纪念日；用 `get_relationship_profile` 补充重要联系人的注意事项。
4. 输出：**待回复（≤5 条，每条一句 + 锚点）** → **今天** → **提醒**。总长 ≤ 200 字。

不主动代发任何消息；早报里只给建议。
