---
name: relationship-recap
description: 回顾与某个联系人的关系脉络：首次联系、关键节点、最近状态、下一步建议
command: /关系
tags: [relationship, contact, recap]
---

# 关系回顾

1. `list_contacts` 解析联系人 → sessionId；`chat_stats({metric:'overview', sessionId})` 拿总量与时间跨度。
2. `chat_stats({metric:'time_distribution', groupBy:'month'})` 找出活跃与沉寂的月份，作为「节点」候选。
3. 对 3–5 个节点月份用 `get_timeline` 抽样（每月 ≤ 40 条），提炼发生了什么。
4. 若已有克隆档案，用 `get_relationship_profile` 补充语气、边界、共同经历。
5. 输出：**一句话关系定位** → **时间线（节点 + 锚点）** → **最近状态** → **建议（1–2 条，可执行）**。

隐私：只在桌面对话里使用，不通过机器人通道对外发送。
