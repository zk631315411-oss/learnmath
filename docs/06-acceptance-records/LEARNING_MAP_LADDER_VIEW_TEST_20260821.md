# 学习地图梯子视图验收记录（2026-08-21）

> 状态：前端技术验收通过；Docker 镜像和干净设备部署不在本记录范围
> 对应计划：`../01-completed-plans/LEARNING_MAP_LADDER_VIEW_PLAN.md`

## 验收范围

- 章总览、节梯子、节点类型图形和五态状态角标；
- 题型侧枝、节点详情卡、聚焦子图和跨章关系 chip；
- 岛屿总览、移动端列表兜底和梯子切换；
- 地图静态目录、用户进度叠加和既有前端问答/阅读链路回归。

## 执行结果

| 检查 | 结果 |
|---|---|
| `cd frontend && npm run test:unit` | 5 个测试文件、21 项通过 |
| `cd frontend && npm run build` | TypeScript 检查和 Vite 生产构建通过；仅有既有 bundle 大小提示 |
| `npx playwright test e2e/frontend-redesign.spec.ts` | 45 passed、47 skipped、0 failed |
| `npx playwright test e2e/review-shots.spec.ts` | 2 passed、2 skipped、0 failed |
| B1 章总览 → 梯子 → 详情 → 跨章 chip | 桌面通过；移动端按测试条件跳过 |
| B2 移动端默认列表 → 手动切换梯子 | 移动端通过 |

Playwright 的 skipped 项是测试文件按浏览器项目主动跳过的桌面/移动不适用场景，不是失败或未执行后被标记为通过。

## 产物

视觉审查截图位于 `artifacts/visual-review-0821/`，包含桌面亮/暗、移动端、章总览、节梯子、详情卡、岛屿总览和列表视图。

## 边界与后续

- 本记录证明视图实现和自动化回归通过，不把地图五态解释为正式知识掌握度；学习掌握模型仍由阶段 3 单独设计。
- 前端生产 bundle 仍有大 chunk 提示，属于后续性能优化项。
- Docker 重建、Windows 干净设备一键部署和真实学生业务有效性，按项目路线图和发布验收单单独跟踪。
