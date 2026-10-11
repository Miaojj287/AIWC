# 003 — 键盘浮层不再滞留；减少动态效果改为「更温和」

- Status：IMPLEMENTED（系统偏好真机验收未完成）
- Commit：1d9dc2e（工作区未提交改动之上）
- Severity：HIGH
- Category：正确性、无障碍、频率
- Scope：`src/kit/kit.css`、`src/platform/inputModality.ts`、`src/styles/motion.test.ts`

## 问题

1. `kit.css` 的键盘模式规则用 `animation: none` 关掉浮层动画。Radix Presence 在关闭时等待**同名动画**的 `animationend` 才卸载节点；动画被置空后事件永远不来，用键盘关掉的 Dialog / Drawer 连同遮罩留在屏幕上，后面的界面点不到。
2. 输入方式只在 `pointerdown` 时回到 pointer：用户按过一次键盘后改用鼠标悬停，Toast、按钮、Tab、开关的过渡仍被键盘规则压掉，直到下一次点击。
3. 同一条键盘规则把 Toast 和控件的 hover 过渡也关了。频率门只针对「键盘主动触发的浮层」，不该波及被动出现的 Toast 和鼠标 hover。
4. 减少动态效果下 `.animate-spin` 被直接停掉：加载图标冻结成一个像坏掉的静态图形，不确定进度条消失。「减少」不等于「归零」。

## 目标与步骤

1. 键盘规则收窄为 `:root[data-input='keyboard'] :is(.kit-overlay, .kit-dialog, .kit-drawer) { animation-duration: 0.01ms }`。动画仍然存在并立即结束，`animationend` 照常触发。
2. `inputModality.ts` 增加 passive、capture 的 `pointermove` 监听；只有模式真的变化时才写 `dataset.input`，移动鼠标不产生重复写入。
3. 删除键盘模式下对 Toast、button、tab、switch 的过渡覆盖。
4. 减少动态效果：浮层保留 120ms 淡入；`.animate-spin` 改为 `kit-breathe`（透明度 1 ↔ .35，单程 1.2s 往返，无位移无旋转）；`.kit-indeterminate` 显示为整条 40% 透明度的轨道；`.animate-pulse`、`.kit-enter`、`.kit-scrollbar` 不动。

## 边界

不改 Radix 组件的受控逻辑，不引入动画库，不改 Toast store。

## 验证

- `npx vitest run src/styles/motion.test.ts src/platform/inputModality.test.ts src/kit`：断言键盘规则体里没有 `animation: none`、reduced-motion 块包含 `kit-breathe`。
- 预览里用键盘打开并用 Esc 关闭 ConfirmDialog：节点与遮罩在下一帧卸载，后面的界面可点。
- 真机系统「减少动态效果」待验收。
