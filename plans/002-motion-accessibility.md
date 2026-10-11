# 002 — 减少运动与进度性能

- Status：IMPLEMENTED（系统偏好真机验收未完成）
- Commit：1d9dc2e
- Severity：HIGH
- Category：无障碍、性能、频率
- Scope：Kit CSS、ProgressBar、Toggle、AgentPet、ContextRing、设置定位

## 问题

基线 `src/kit/ProgressBar.tsx:27` 为 `transition-[width]`；`src/kit/kit.css:101` 的 reduced-motion 只覆盖浮层；设置 `pageKit.tsx:73` 无条件 smooth scroll。宠物 sprite 已支持减少动态效果，但按钮仍 active:scale-95。

## 目标与步骤

1. ProgressBar 的 fill 固定全宽，进度由 `transform: scaleX(value / 100)` 表达，origin-left、180ms `cubic-bezier(0.23, 1, 0.32, 1)`；语义值仍夹在 0–100。
2. reduced-motion 下进度、开关位置立即变化；spinner / skeleton / 不确定进度不循环；dialog / drawer 改 120ms opacity 淡入淡出，Toast 只淡入。
3. 设置搜索、Kit 目录定位用 instant；Tab、会话和上下文环不补间。
4. 宠物保留既有用户配置和第一帧降级；去掉按钮缩放，仅 mouse pointer hover 才触发挥手。保留冷却，不新增动态装饰。
5. 功能栏亮度反馈保留，但删除 filter 过渡。

## 边界

不改任务状态机、虚拟列表、宠物 sprite 表或主题配置 schema。CSS 处理离散状态，无新增库。

## 验证

- `npx vitest run src/features/pets src/styles/motion.test.ts src/kit`。
- `npm run build`，确认 CSS 被打包。
- 真机打开系统减少动态效果：加载仍有状态名，进度仍更新但不移动补间，宠物第一帧，无位置跳转。系统媒体查询当前仅源码约束与构建验证，真机偏好验收待补。
