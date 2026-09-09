---
name: weekly-report
description: 把一个群或多个会话最近一周的讨论整理成周报草稿（议题 / 结论 / 待办 / 风险）
command: /周报
tags: [report, group, summary]
---

# 周报草稿

1. 用 `get_timeline`（sessionId + 最近 7 天）拉取消息；超过 400 条时分两段拉，先按天分组。
2. 大群先跑 `group_member_ranking` 了解谁在主导，方便按人归因。
3. 提炼为：**议题**（每条附首次出现的锚点）→ **结论/决定**（谁定的、什么时候）→ **待办**（负责人、期限，缺失的写「未明确」）→ **风险**（交付、预算、人员，各一句）。
4. 用 `create_artifact`（若可用）或直接输出 Markdown 文件内容，文件名 `周报-<群名>-<YYYYMMDD>.md`。
5. 发到群之前必须让用户确认；发送只能用 `send_message` 且只发回用户指定的会话。

语气：客观、短句、不用表情符号；数字保留原文。
