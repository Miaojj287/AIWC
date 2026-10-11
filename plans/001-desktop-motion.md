# 001 — 统一浮层反馈

- Status：IMPLEMENTED（原生视觉验收未完成）
- Commit：1d9dc2e
- Severity：HIGH
- Category：频率、缓动、空间关系、中断性
- Scope：src/kit/kit.css、src/styles/tokens.css、src/platform/inputModality.ts、src/app/App.tsx

## 问题

基线 `src/kit/kit.css:92–98` 使用 `ease-in` 退出、无条件菜单缩放与 Toast keyframe：

```css
.kit-dialog[data-state='closed'] { animation: kit-pop-out var(--dur-fast) ease-in; }
.kit-menu[data-state='open'] { animation: kit-menu-in var(--dur-fast) ease-out; }
.kit-toast { animation: kit-toast-in var(--dur-base) ease-out; }
```

弹窗的 keyframe 还叠加了布局已有的居中 translate。

## 目标与步骤

1. 在既有 tokens.css 添加 `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`、`--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`、`--dur-surface: 220ms`；保留 120 / 180ms。
2. 高频 menu / select / tooltip 即时显示；保留 Radix 原点变量以说明浮层归属，不添加缩放。
3. 偶发 dialog 220ms 进入、120ms 退出，只动画 scale(0.97) ↔ scale(1) 与 opacity；居中仍由 Tailwind translate 负责。drawer 220ms 进入、180ms 同侧退出。
4. Toast 使用 @starting-style，opacity 0 / translateY(25%) → 1 / 0，180ms ease-out transition。关闭立即卸载，明确不引入新的退出状态和延迟；同 id 更新不重新挂载。
5. 在 platform 安装 capture 阶段输入模式监听，App effect 负责释放；键盘触发浮层无动画，控件状态无过渡。

## 边界

不修改业务、IPC、审批、菜单命令或 Radix 焦点管理；不安装动画库，不新增手势。遵循 Kit 与 token 单一实现。

## 验证

- `npm run typecheck`、`npm run lint`、`npx vitest run src/kit src/platform/inputModality.test.ts src/styles/motion.test.ts`。
- 浏览器在 1200×720 打开复制规则弹窗，确认居中、搜索焦点、关闭和返回；键盘打开菜单并导航。
- 原生真机以 2–5 倍时长慢放检查进入/退出无跳位，快速反向开关检查 Radix Presence；当前 Mac 锁屏，未宣称完成逐帧体验验收。
