# 桌面动效升级计划

基线提交：`1d9dc2e`。顺序为 001 → 002 → 003 → 004 → 005；无新增依赖。用户已授权审计后继续实施，故不重复等待逐条选择。

| 计划 | 优先级 | 状态 |
|---|---|---|
| [001 统一浮层反馈](001-desktop-motion.md) | HIGH | 已实施，源码复审通过；原生慢速逐帧验收待真机 |
| [002 减少运动与进度性能](002-motion-accessibility.md) | HIGH | 已实施；系统偏好真机验收待补 |
| [003 键盘浮层不再滞留；减少动态效果改为更温和](003-keyboard-overlays-and-gentle-reduced-motion.md) | HIGH | 已实施；系统偏好真机验收待补 |
| [004 直接操纵：Tab 拖动、滚动条、抽屉遮罩](004-direct-manipulation.md) | MEDIUM | 已实施；120Hz 逐帧验收待真机 |
| [005 少量值得加的状态动效](005-watched-state-changes.md) | LOW | 已实施 |

全量体验审计、平台边界和测试结果见 [审计记录](../docs/design/desktop-experience-audit.md)。
