# 004 — 直接操纵：Tab 拖动跟手、滚动条淡入、抽屉遮罩同步

- Status：IMPLEMENTED（120Hz 真机逐帧验收未完成）
- Commit：1d9dc2e（工作区未提交改动之上）
- Severity：MEDIUM
- Category：物理感、空间一致性、可打断
- Scope：`src/workspace/TabStrip.tsx`、`src/kit/kit.css`、`src/kit/ScrollArea.tsx`

## 问题

1. 拖动 Tab 排序时，被拖的标签原地变成 70% 透明、不跟手；越过邻居中点后整排瞬间换位。手指动了而对象没动，是「断开连接」的典型来源；换位没有过程，用户要重新找标签。
2. kit `ScrollArea` 的滚动条硬切显示 / 隐藏。
3. 抽屉 180ms 滑出，但遮罩按弹窗的 120ms 先消失，两者脱节。

## 目标与步骤

1. `useTabDrag(order)`：`pointerdown` 记录抓取点；`pointermove` 超过阈值后进入拖动，被拖标签用 `translateX` 1:1 跟随指针（抓住哪里就停在哪里），`z-10` 浮在邻居之上，不再变透明。
2. 越过邻居中点时更新顺序；受影响的邻居用 FLIP（WAAPI，120ms，`cubic-bezier(0.23, 1, 0.32, 1)`）从旧位置滑到新位置。只动 `transform`。
3. 松手：被拖标签从当前偏移滑入槽位（同一时长与曲线）。拖动途中再次越界会从当前视觉位置继续，不会跳。
4. `prefers-reduced-motion` 或环境没有 `Element.animate`（jsdom）时直接换位。键盘移动标签不走这条路径。
5. `.kit-scrollbar`：`@starting-style` + `[data-state='hidden']` 做 120ms 透明度过渡。
6. `.kit-overlay:has(+ .kit-drawer)[data-state='closed']` 用 `--dur-base`，与抽屉同时结束。

## 边界

不改 Tab 的数据模型与 `tabsStore.move`；不引入拖拽库；不给 Tab 切换、关闭加动画（高频）。

## 验证

- `npx vitest run src/workspace`。
- 预览：拖动标签左右越过两个邻居再松手；拖动中途反向；减少动态效果下拖动。
