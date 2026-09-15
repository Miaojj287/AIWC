---
name: office-table
description: 把微信里的信息整理成表格，推送到飞书多维表格 / 钉钉 AI 表格 / 企业微信智能表格
command: /推送表格
tags: [office, feishu, dingtalk, wecom, table]
---

# 推送表格到办公平台

适用：用户要把聊天里的信息「整理成表格 / 汇总到飞书 / 同步到钉钉 / 放进企业微信表格」，或者只是想连接这几个平台。

## 1. 确认平台和连接

- 平台不明确时只问一句：飞书、钉钉还是企业微信。
- 先调用 `office_status`。没连接就用一句话告诉用户「浏览器会打开授权页，按页面完成即可」，然后调用 `office_connect`。它会自己等用户在浏览器里完成、完成后自动返回：不要让用户回来回复，也不要重复调用。
- `office_connect` 失败时原样转述 error。`needs_admin` 说明钉钉需要组织管理员在开发者平台开启「CLI 访问」；返回里有 `command` 就把命令给用户。

## 2. 取数

- 先用微信工具查证：`search_messages` / `semantic_search` 找线索，`get_timeline` / `get_context` 通读原文；计数、排名用 `chat_stats`、`group_member_ranking`，不要靠检索去数。
- 每一行都要能在聊天记录里找到依据。缺的值留空，不要猜，也不要补全。

## 3. 设计表格

- 第一列放最能标识一行的内容（事项 / 问题 / 客户）。它是主字段，一律按文本写入。
- 列要少而准，通常 3–8 列；列名短、不重复。
- 类型：金额、数量用 `number`；日期用 `date`（`YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm`）；状态、分类这类取值有限的用 `select`；标签用 `multi_select`；是否完成用 `checkbox`；链接用 `url`；其余 `text`。
- 需要回溯出处时加一列「来源」，写「群名 · 发送人 · 月-日」。不要把 wx:// 引用链接写进表格，平台上点不开。
- 表名写清范围和时间，例如「项目群待办 09-07~09-13」。

## 4. 预览，然后推送

- 推送前先在回复里用 Markdown 表格预览前几行，并说明总行数、列和目标平台。用户已经明确要求推送时可以直接调用：确认弹窗会把全部内容展示给用户。
- 调用 `office_push_table`。新建时不传 `target`；「追加到上次那张表」用 `office_status` 里 `recentPushes` 的 `pushId`；用户给了表格链接就传 `url`。
- 超过 5000 行拆成多次推送，第二次起用第一次返回的 `pushId` 追加。

## 5. 收尾

- 成功：一句话给出表格名、写入行数和链接（`url` 原样粘贴），`warnings` 有内容就逐条转述。
- `not_connected`：调用 `office_connect`，成功后重试一次推送。
- 企业微信 851003：说明是企业规模限制（可见范围超过 10 人时 CLI 不能直接写记录），建议改推到飞书或钉钉。
- 其他错误原样转述，不要换一种方式反复重试。

## 表格以外的操作

发群消息、写文档、更新某几条记录、建日程这类事：用 `shell` 直接调官方 CLI。先读说明，确认参数后再执行，每次一条命令，`reason` 里写清楚要做什么。

- 飞书：`lark-cli skills list`、`lark-cli skills read lark-base`，或 `lark-cli <业务域> --help`。
- 钉钉：`dws <产品> --help`，例如 `dws aitable --help`。
- 企业微信：`wecom-cli <服务> --help`，例如 `wecom-cli smartsheet --help`。
- 只读命令（help / list / get / search）直接放行；写入类命令会先弹确认；`auth logout`、删除、撤回、常驻监听这类命令会被拒绝——告诉用户去终端自己做。
