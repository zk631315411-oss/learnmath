# 学习地图 · 梯子视图样式与修改计划

> 总控计划：`FRONTEND_MASTER_PLAN.md`（三条工作线的汇总与依赖关系）。

> 日期：2026-08-21（v3 修订）
> 状态：**v2/v3 均已实现并通过技术验收（见 §7）；本文作为已完成计划保留**
> 前置：静态目录链路已换新（见"1. 已落地"），本计划只涉及前端视图层
> 关联文档：`LEARNING_MAP_STATIC_CATALOG_PROGRESS_PLAN.md`、`../02-pending-plans/KG_KNOWLEDGE_MAP_PLAN_DRAFT.md`
> 最终样式参照：`artifacts/kg-map-mockup/gaodai-ch1.html`（案例 ⑦ 样式 E v3，真实数据可运行）

## 0. 结论

学习地图的章视图升级为 **E v3 定稿样式**：进入章节先看**章总览**（节列表 + 五态聚合条，不画图）；点开小节后出现**竖向正弦蜿蜒梯子**——核心知识点（概念/定理/公式/方法）严格按教材顺序自上而下爬梯，节点是**小图形**（形状=类型，右上角角标=学习状态），题型（ProblemClass）以纸页图形侧枝挂在它「使用」的知识点上；点击任意图形 → 下方内联展开**三栏聚焦子图**（左来源·入 / 中选点 / 右去向·出）+ 关系明细卡；「岛屿总览」按整章连通分量分岛，蛇形横轴=教材出现顺序。列表视图保留为移动端与无障碍兜底。

v2（横向蛇形 + 胶囊节点 + NodeEgoPanel 浮层）已废弃：横向排布违背"从上往下读教材"的心智模型，胶囊节点信息密度低且无视觉锚点。v3 以 mockup 案例 ⑦ 为唯一标准。

## 1. 已落地（对接方须知：这些已完成）

| 事项 | 状态 | 位置 |
|---|---|---|
| 高代两册 KG 修复（1.3 重抽合并、503 条网络牺牲真审、2156 条标签订正、有理化法回补） | 已入 Aura | 批次 `gaodai_v4_4_reaudit_restore_20260820` |
| 全书节点教材顺序（`order_hint`，锚点级精确） | 已入 Aura | 节点属性 `order_hint` |
| 导出器：核心五类过滤、节序数字序修复、每章边导出 | 已合入 | `app/db/kg_v44.py`、`scripts/export_learning_catalog.py` |
| 静态目录重出（含 `edges`） | 已落盘 | `frontend/public/map-catalog/*.json` |
| TS 类型契约 | 已合入 | `frontend/src/catalog/types.ts`（`CatalogEdge`） |
| `edgesByChapter` 接线 | 已合入 | `frontend/src/hooks/useMapHomeData.ts`（跨章边带 `sourceChapter/targetChapter`） |

**规模基准**：高代上册 746 节点 / 565 边，下册 1358 节点 / 535 边；高数上 769、下 618。第 1 章（高代上）60 节点 / 62 条章内边。

### 数据限制（v3 设计据此裁剪）

1. **`CatalogEdge = { source, target, type }` 无 `status` 字段**——mockup 中"待审核虚线"无法落地，v3 全部按已确认实线绘制；若后续导出审核状态，再补虚线线型。
2. **RuleCase（规则）不在静态目录里**——mockup 案例 ⑧ 的规则展开本期不做，不伪造文本。
3. 进度字段不变：`progress.nodes[node_id] = { status, closed_evidence_count, source_chat_id }`；`blocked` 由前端从 `prerequisite_ids` + 进度现算。

## 2. 视觉与交互设计定稿（E v3）

设计以 `artifacts/kg-map-mockup/gaodai-ch1.html` 案例 ⑦ 的**实际代码**为准（不是 §2 旧文字）。规格如下。

### 2.1 屏级结构（桌面地图模式）

```
章总览（默认首屏）──点节行──▶ 节梯子屏 ◀──▶ 岛屿总览屏
                                 │
                          点图形 → 下方内联详情卡（聚焦子图 + 关系 chips + 操作按钮）
```

- 三屏共用同一个 `chapter-ladder-view` 容器；梯子屏头部有「← 返回总览」+ 节切换下拉 + 「显示题型」+「岛屿总览」开关 +「图例」折叠。
- 移动端（< sm）默认列表视图不变，可手动切地图。

### 2.2 节梯子：竖向正弦蜿蜒

- 主梯只排核心节点（非 ProblemClass），按 `order` 升序，几何：
  `x = cx + amp·sin(i·0.92)`，`y = padT + i·gapY`；常量 `cx=350, amp=150, gapY=92, padT=56, W=700`。
- 主梯连接线（spine）= 相邻核心节点的直线段，中性灰宽线（`stroke: var(--lm-border)`，9px，round 端点）。路径颜色不承载进度语义——进度只看角标。
- 题型侧枝：挂到它在节内第一条出边/入边所连的核心节点；无关系则挂讲授序最近的核心节点。位置 `x = 宿主x + side·(54 + k·58)`，`y = 宿主y + 30`（`side = 宿主x ≥ cx ? +1 : -1`），短柄细线（`--lm-edge`，1.4px）。

### 2.3 节点 = 小图形；状态 = 右上角角标

| 类型 | 图形 | 类型色（CSS 变量） |
|---|---|---|
| Concept 概念 | 圆 r7 | `--lm-type-concept` #64748b |
| Theorem 定理 | 三角 | `--lm-type-theorem` #7c3aed |
| Formula 公式 | 圆角方 13×13 | `--lm-type-formula` #0d9488 |
| Method 方法 | 六边形 | `--lm-type-method` #2563eb |
| ProblemClass 题型 | 纸页 + 两横线 | `--lm-type-problem` #d97706 |

- 全部 `fill: var(--lm-surface)`、`stroke: 类型色 2px`。
- 角标在 `(9, -9)`、r4：未探索=空心（描边状态色，填 surface），其余=实心状态色。状态色一律用既有 `--lm-status-*` 变量（五态契约以 app 为准，不用 mockup hex）。
- `blocked`（前置需巩固）：左上角 `(-9,-9)` 琥珀小点 r3，title「可能受阻」。
- 选中：`scale(1.35)` + halo 圈（`--lm-brand`，r12）；一跳邻居 halo 60% 透明度（`--lm-text-muted`）。
- 名称：核心节点**全程显示**（右侧节点 `anchor=start, x+16`；左侧 `anchor=end, x-16`），带 `paint-order: stroke` 白描边防压线；选中后非邻居名字变淡。侧枝名称仅在自身被选中时显示（朝向梯子一侧防裁边）。
- SVG 文本无法走 KaTeX，标签用去掉 `$` 的纯文本；总览行、详情卡等 HTML 语境仍用 `InlineMathText`。

### 2.4 边与选中态

- 梯子屏默认**不画关系边**（稠密小节 33 条边全铺是噪声——mockup 评审结论），只画 spine + 侧枝短柄；选中节点后其一跳边也不画在梯子上，关系表达全部交给下方聚焦子图。
- 岛屿总览才画全部关系边：选中节点的出边=紫 `--lm-brand` 2.2px、入边=橙 `--lm-edge-in`（亮 #d97706 / 暗 #fbbf24）2.2px、其余 dim 至 0.08。

### 2.5 三栏聚焦子图 + 详情卡（内联，删除浮层）

- 点击任意图形（梯子/侧枝/岛屿/子图邻居）→ 图下方内联展开详情卡；再次点击同一图形取消。**NodeEgoPanel 浮面板方案作废，文件删除。**
- 聚焦子图三栏：左列来源（入边）`x=130` 橙、中选点 `ccx=340` `scale(1.5)`、右列去向（出边）`x=550` 紫；`rowH=46, padT=40, FW=680`。边为三次贝塞尔（入：`M x+10 y C x+100 y, ccx-100 ccy, ccx-12 ccy`，出反向），关系词写在中点。邻居图形可点击继续钻取；邻居在他节时名称前带灰色小节标签（如 `1.2·`），点击后梯子自动切到该节并选中。
- 关系词表（REL_CN）：USES 使用 / DERIVES 推导出 / GETS 得到 / HAS_PROPERTY 具有性质 / SUPERIOR 上位于 / PART_OF 组成于 / EQUATIVE 并列于 / PREREQUISITE_OF 前置于。
- 详情卡内容：迷你图形 + 名称 + 类型 chip + 状态 chip（+受阻标记）；`所属：节名 · N 条出边 · M 条入边（整章）`；关系 chips（出=紫框 `关系词 → 名`，入=橙框 `名 → 关系词`，可点击跳转）；跨章边显示为不可点的「通往 {章名}」chip；按钮「继续学习/复习」（复用 `onContinueNode`）与「来源提问」（`onOpenChat`，不可用则禁用）。

### 2.6 章总览（首屏）

- 节列表行：节名 + **五态状态聚合条**（flex 横条按占比分段着色，色同 `--lm-status-*`）+ `N 知识点 · M 关系`。**不画图**，点击行进该节梯子。
- 行 testid：`overview-section-{节名}`。

### 2.7 岛屿总览

- 整章（受「显示题型」开关过滤）并查集求连通分量，按岛内最小教材序排序。
- 主岛（>1 节点）**真二维**小图：横轴钉死教材出现顺序（`stepX=110` 等距），纵轴用重心松弛迭代（12 轮，向邻居均值 0.5 权重靠拢——迭代过多会摊平成噪声）自然成团，归一化到紧凑纵带（`bandH=clamp(n·5, 140, 320)`，不强行摊满全高）；防重叠只管横向相邻对，单次左→右按松弛趋势方向硬设 `minGapY=32`；边统一画向上弯的二次贝塞尔弧（`bow=min(16+span·4, 64)`）。
- **降乱（v3.1，真实数据评审后修订）**：默认只画 PREREQUISITE_OF 前置主干；选中节点时叠加它的一跳出入边（出紫入橙，其余 dim）。节点名单行最多 8 字（超出 `…`）。
- 岛头：`岛 N · n 节点 · 跨 1.1/1.2 ·（本章主干）`；所有节点名前带灰色小节标签（章级视图无"当前节"，与 mockup 的节级语境不同，统一都带）。
- 孤立点（无任何已连边）合并成一个面板如实列出，图形+名字可点选。
- 右下角隐藏轴标注：`蛇形排列 · 按教材出现顺序` / `教材出现顺序 →`。

### 2.8 图例

折叠式 `<details>`：五态角标、类型图形（形状+色）、类型徽标、选中出边紫 / 选中入边橙 / 学习路径灰宽线。无"待审核虚线"项（见 §1 数据限制 1）。

### 2.9 主题

明暗双主题全部走 CSS 变量；新增 `--lm-edge`（#c7cedb / 暗 #475569）、`--lm-edge-in`（#d97706 / 暗 #fbbf24）、`--lm-type-*` 五色。中文不用斜体。

## 3. 修改清单（文件级，v3）

### 新增

| 文件 | 说明 |
|---|---|
| `frontend/src/components/kg/NodeGlyph.tsx` | 类型图形 + 状态角标 + halo + 受阻点（SVG 内复用单元） |
| `frontend/src/components/kg/ChapterOverview.tsx` | 章总览：节行 + 五态聚合条 + 关系统计 |
| `frontend/src/components/kg/FocusSubgraph.tsx` | 三栏聚焦子图（来源/去向贝塞尔流 + 可钻取邻居） |
| `frontend/src/components/kg/NodeDetailCard.tsx` | 内联详情卡（聚焦子图 + 关系 chips + 跨章 chips + 操作按钮） |
| `frontend/src/components/kg/ChapterIslands.tsx` | 岛屿总览（连通分量分岛 + 孤立点面板） |

### 重写

| 文件 | 改动 |
|---|---|
| `frontend/src/utils/ladderLayout.ts` | 废弃横向蛇形；改为正弦梯子布局、侧枝挂载、连通分量/岛屿布局等纯函数 |
| `frontend/src/utils/ladderLayout.test.ts` | 单测同步重写：正弦几何、侧枝挂载与朝向、并查集分岛、蛇形分行 |
| `frontend/src/components/ChapterLadderView.tsx` | 改为三屏容器（总览/梯子/岛屿）+ 选中态 + 内联详情卡；保留 `chapter-ladder-view`、`ladder-section-{节名}` testid 与「显示题型」开关文案 |
| `frontend/src/index.css` | 新增 `--lm-edge`、`--lm-edge-in`、`--lm-type-*` 变量与 `.kg-*` 图形类 |

### 删除

| 文件 | 原因 |
|---|---|
| `frontend/src/components/NodeEgoPanel.tsx` | 浮层方案作废，由内联 NodeDetailCard 取代 |

### e2e 同步

- B1 重写：进章 → 章总览可见 → 点节行 → 梯子出现 → 点图形出详情卡 → 邻居钻取 → 跨章「通往」chip → 显示题型开关。
- B2（移动端默认列表）不动；E7 与视觉归档流程补"先过章总览"一步。
- `e2e/review-shots.spec.ts`（视觉自查脚本）更新为新流程截图。

### 不改

- 数据管线、进度投影、`MapHome` 章列表、`LearningMapPanel` 侧栏、列表视图、SSE 问答协议。

## 4. 数据契约（不变）

章详情 JSON（`map-catalog/{textbook_id}.json`）：

```jsonc
{
  "edges": [
    { "source": "gaodai_shang:node:xxx", "target": "gaodai_shang:node:yyy", "type": "PREREQUISITE_OF" }
  ]
}
```

- `edges` 为**全书**数组（跨章边保留，前端按章切片）；两端节点均为核心五类；已去重；**无 status 字段**。
- 节点顺序：节内按 `order` 升序即教材讲授顺序（数据源 `order_hint`，锚点级）。

## 5. 里程碑与验收（v3）

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 布局层 | `ladderLayout.ts` 正弦梯子 + 侧枝 + 岛屿纯函数与单测 | 已完成 |
| M2 梯子屏 | NodeGlyph + 节梯子 + 名称/变淡规则 + 受阻点 | 已完成 |
| M3 详情闭环 | 聚焦子图 + 详情卡 + 跨章 chip + 删 NodeEgoPanel | 已完成 |
| M4 总览与岛屿 | 章总览聚合条 + 岛屿总览 + 孤立点面板 + 图例 | 已完成 |
| M5 收尾 | e2e B1/B2/E7/视觉归档/review-shots 更新，`build` + `test:unit` + 前端全量 e2e 通过 | 已完成 |

## 6. 已决问题

1. 移动端默认列表，可手动切换地图。
2. 跨章边在详情卡显示为不可点的「通往 {章名}」chip。
3. 继续/复习复用 `onContinueNode` 的 PDF 定位逻辑；来源提问复用 `onOpenChat`。
4. 目录边无审核状态 → 全部实线，图例不含待审核项（v3 限制，见 §1）。
5. 规则（RuleCase）不进详情卡（静态目录无数据，不伪造）。
6. 梯子屏不画关系边；关系只在聚焦子图与岛屿总览表达。
7. 钻取到他节邻居：梯子自动切节并选中；题型被「显示题型」关闭时忽略跳转到题型的点击。

## 7. 验收结果

### v2（2026-08-21 上午，已废弃的横向蛇形方案）

- `npm run test:unit`：12 passed；`npm run build`：通过；Playwright 全量：65 passed、55 skipped、0 failed。
- 视觉归档：桌面/移动、亮/暗主题均无横向溢出或控件遮挡。

### v3

- `npm run test:unit`：5 个测试文件、21 项通过。
- `npm run build`：TypeScript 检查和 Vite 生产构建通过；仅保留既有 bundle 大小提示。
- `npx playwright test e2e/frontend-redesign.spec.ts`：45 passed、47 skipped、0 failed；B1、B2、E7、M1–M7、D1 和 E1–E20 均在桌面项目通过，移动项目按测试条件跳过不适用用例。
- `npx playwright test e2e/review-shots.spec.ts`：2 个视觉审查项目通过、2 个按项目条件跳过，截图写入 `artifacts/visual-review-0821/`。
- 详细前端回归快照见 [梯子视图验收记录](../06-acceptance-records/LEARNING_MAP_LADDER_VIEW_TEST_20260821.md)。

Docker 镜像重建和干净设备部署属于发布验收，不作为本计划的前端视图完成条件，按 [当前项目路线图](../04-project-map/PROJECT_ROADMAP.md) 单独跟踪。
