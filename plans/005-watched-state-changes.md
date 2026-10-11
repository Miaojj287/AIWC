# 005 — 少量值得加的状态动效

- Status：IMPLEMENTED
- Commit：1d9dc2e（工作区未提交改动之上）
- Severity：LOW
- Category：状态指示、频率
- Scope：`src/kit/kit.css`（`.kit-enter`）、`src/kit/DialogVariants.tsx`、`src/features/onboarding/AccountCard.tsx`、`src/features/chat/MessageRow.tsx`、`src/features/chat/Lightbox.tsx`、`src/features/pets/useSpriteFrame.ts`

## 筛选

按 find-animation-opportunities 的频率门筛过一遍：这个产品绝大多数操作（切会话、切 Tab、切设置页、菜单、hover 露出按钮、选中消息）一天上百次，结论都是「不加」。留下的只有用户正在等、正在看、且一次会话里只发生几次的状态变化。

| # | 位置 | 之前 | 现在 | 目的 | 频率 |
|---|---|---|---|---|---|
| 1 | 长任务步骤 ○ → ✓ | 图标硬切 | `.kit-enter`：scale .96 → 1 + 淡入，220ms | 状态指示：这一步刚完成 | 每个长任务几次 |
| 2 | 向导「账号已验证」 | 提示文字硬切 | 同上，成功提示换 `key` 重新挂载播放一次 | 里程碑反馈 | 一生一次 |
| 3 | 聊天跳转高亮 | 进出都是 180ms | 瞬间点亮，220ms 淡出；选中消息即时 | 「就是这条」要马上看到；离开可以慢 | 偶发 |
| 4 | 图片灯箱关闭 | 内容先被清空，120ms 退出动画播放的是空壳 | 退出期间保留最后一张媒体 | 修正：退出动画要有东西可退 | 偶发 |
| 5 | 宠物逐帧 | 窗口隐藏时仍每秒数次唤醒渲染进程 | `visibilitychange` 暂停，恢复时从同一帧继续 | 性能 | 常驻 |

## 明确不加

- 会话 / Tab / 设置页切换的过渡（高频、键盘可达）。
- 列表行进入 stagger（用户在读数据，不是在看演出）。
- 列表选中、设置导航、hover 露出的按钮的颜色过渡（已移除原有的 120ms）。
- Markdown 代码块「复制」按钮与微信卡片的 hover 透明度过渡（全应用 hover 露出一律即时）。
- 审批卡出现的动画（它打断的是用户正在做的事，必须立刻可读）。

## 验证

- `npx vitest run src/kit src/features/chat src/features/onboarding src/features/pets src/styles`（含 `useSpriteFrame.test.ts` 的假时钟用例）。
- 减少动态效果下 `.kit-enter` 只保留淡入。
