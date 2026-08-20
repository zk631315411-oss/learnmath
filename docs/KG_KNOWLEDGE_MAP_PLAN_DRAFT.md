# LearnMath 基于真实 KG 的知识地图改造计划（草稿）

> 日期：2026-08-20  
> 状态：待审阅，不代表本轮已经开始实施。  
> 关联文档：`MAP_PAGE_REDESIGN_PLAN.md`、`LEARNING_MAP_STATIC_CATALOG_PROGRESS_PLAN.md`

## 1. 目标与产品形态

学习地图要让用户在打开一章后回答三个问题：

1. 这一章由哪些节/小节组成？
2. 当前小节的知识之间怎样关联？
3. 我已经学会什么，下一步应该学什么？

因此地图采用三层交互，而不是把整章所有节点一次性铺成一张力导向图：

```text
教材 → 章节结构总览 → 小节真实关系图 → 节点详情与规则展开
```

### 1.1 章节结构总览

- 进入章节后先显示“章 → 节 →（有数据时）小节”的层级结构。
- 每个节显示核心知识点数量、已探索数量、状态分布和最近学习位置。
- 首屏不绘制整章关系线；用户点击某一节/小节后才加载关系图。
- “开始本章”和“继续学习”仍然进入 PDF 阅读器，结构总览不会替代阅读入口。

### 1.2 小节真实关系图

- 图的范围限定为当前小节，必要时允许切换到相邻小节，不默认跨章。
- 默认显示 `Concept`、`Theorem`、`Formula`、`Method` 四类知识节点。
- `ProblemClass` 是题型应用层，默认收起，可通过“显示应用题型”展开。
- 节点状态使用用户进度着色；未探索节点仍显示为灰色，避免只看到已学内容而误判结构。
- 关系线只来自已通过语义门禁的真实 KG 边，不为了视觉完整而补线。

### 1.3 节点详情与规则展开

点击节点打开详情面板，至少包括名称、类型、所属小节、PDF 页码、学习状态和继续/复习入口。

`RuleCase`、`ConditionExpression`、`Outcome`、`KnowledgeGroup` 不作为普通学习节点平铺在主图上。它们在节点详情中以“适用条件 → 结论”的折叠区域展示；缺少条件或结论时明确显示“暂无规则说明”，不伪造文本。

## 2. 已核查的 KG 数据边界

本方案以 Aura/Neo4j 当前真实数据为准，不根据思维导图模板反推数据结构。最近核查结果：

| 指标 | 当前数量/事实 | 设计含义 |
|---|---:|---|
| 总节点 | 8,668 | 不能在地图启动时全部传给浏览器 |
| 核心可学习节点 | 3,320 | 默认地图节点池，包括 `ProblemClass` |
| 核心节点间关系 | 1,814 | 小节图的主要关系来源 |
| `PREREQUISITE_OF` | 4 条 | 只能作为极少量、经审核的学习阻断依据 |
| 隐式边 | 117 条 | 必须经过语义门禁，confidence 不能单独代表正确性 |

核心节点按教材：`gaodai_shang` 721、`gaodai_xia` 1,212、`gaoshu_shang` 769、`gaoshu_xia` 618。单节核心节点约 5–89 个，中位数约 13–34 个，因此“按小节展开”比整章总图更适合首版交互。

当前常见关系包括：

`USES`、`HAS_PROPERTY`、`DERIVES`、`SUPERIOR`、`GETS`、`PART_OF`、`APPLIES_TO`。

这些关系表达的是使用、属性、推导、层级、产出、组成和应用，不应全部解释为“先学 A 才能学 B”。只有明确、方向正确且已审核的 `PREREQUISITE_OF` 才能影响“受阻”“推荐下一步”等学习逻辑。

## 3. 节点和关系的展示规则

### 3.1 节点分层

| 层级 | 节点类型 | 默认展示 | 作用 |
|---|---|---|---|
| 核心知识 | `Concept`、`Theorem`、`Formula`、`Method` | 展示 | 用户学习和状态投影的主体 |
| 应用扩展 | `ProblemClass` | 收起 | 连接知识与题型，按需查看 |
| 规则辅助 | `RuleCase`、`ConditionExpression`、`Outcome` | 不平铺 | 在详情中解释适用条件和结论 |
| 组织辅助 | `KnowledgeGroup` | 不作为学习点 | 用于分组或构建期校验 |

所有核心节点都显示以下五种状态，并同时提供文字或图标，不只依赖颜色：

- 未探索：灰色
- 学习中：黄色
- 基本掌握：浅绿
- 已掌握：深绿
- 需要巩固：红色

进度状态仍由后端 `project_status()` 计算，前端只把状态叠加到静态节点和章节聚合上。

### 3.2 关系语义与视觉

第一版不把每个关系名都做成高噪声标签。建议采用统一细线和方向箭头，悬停/选中时显示关系中文解释：

| KG 关系 | 默认解释 | 是否参与学习阻断 |
|---|---|---|
| `PREREQUISITE_OF` | 前置于 | 仅审核通过后参与 |
| `DERIVES` | 推导出 | 否，作为知识解释 |
| `USES` | 使用 | 否，作为方法依赖说明 |
| `GETS` | 得到/产出 | 否，作为过程说明 |
| `HAS_PROPERTY` | 具有性质 | 否，作为属性说明 |
| `PART_OF` / `SUPERIOR` | 组成/层级 | 否，作为结构说明 |
| `APPLIES_TO` | 应用于 | 否，连接题型应用层 |

关系线的颜色和粗细保持克制：默认中性灰，选中节点的入边/出边使用方向色；不使用彩虹色区分每一种关系，避免图例取代内容。

## 4. 隐式边语义门禁

当前 117 条隐式边中 116 条 confidence ≥ 0.80，但全部带有“缺少连续教材证据”的标记。因此 confidence 只能用于审核排序，不能直接作为“正确关系”或学习阻断依据。

### 4.1 进入主图的条件

隐式边必须同时满足：

1. 起点、终点属于同一教材，且章节/小节归属有效。
2. 关系类型属于允许的语义白名单。
3. 方向与关系解释一致，并通过规则化校验。
4. 有人工或可追溯的模型审核记录，状态为 `approved`。

通过门禁的隐式边与显式边使用同一视觉样式；未审核或有争议的边不进入主图。数据层仍保留 `source=implicit`、`confidence`、`evidence_refs`、`review_status`，便于后续复核。

### 4.2 关系修正原则

对 `Concept --GETS--> Formula`、`Formula --SUPERIOR--> Concept`、`ProblemClass --APPLIES_TO--> Concept` 等标签边界问题，先在导出/审核阶段修正；无法确认时降级为普通关联或隐藏，不把错误语义带到前端。

## 5. 静态目录与构建产物

现有 `scripts/export_learning_catalog.py` 已负责章节、节点和页码目录，本计划是在其上扩展，不另造第二套导出脚本。

### 5.1 目录字段扩展

在不破坏现有 `manifest.json` 兼容字段的前提下增加：

```json
{
  "node_id": "gaodai_shang:node:xxx",
  "name": "矩阵消元法解线性方程组",
  "type": "Method",
  "chapter_id": "gaodai_shang:chapter:1",
  "section_id": "gaodai_shang:section:1.1",
  "subsection_id": null,
  "order": 12,
  "page": 34,
  "edges": [
    {
      "edge_id": "...",
      "target_id": "...",
      "type": "USES",
      "direction": "outgoing",
      "source": "explicit",
      "confidence": null,
      "review_status": "approved"
    }
  ],
  "rule_case_ids": []
}
```

字段要求：

- `node_id` 在教材内唯一，且教材前缀正确。
- `chapter_id`、`section_id` 必须能回溯到目录层级；若 KG 没有独立 subsection，则使用 `null`，不凭名称猜造。
- `edges` 只包含通过导出校验的边；完整边可按小节拆分资源。
- `page` 缺失时为 `null`，阅读跳转再走 `section-page` fallback。

### 5.2 分层资源

当前根 `manifest.json` 约 2.3 MB，包含四本教材的节点索引，首屏负担过重。调整为：

```text
frontend/public/map-catalog/
├── manifest.json                 # 教材元数据、章节摘要、资源路径
├── gaodai_shang/index.json       # 当前教材最小节点索引
├── gaodai_shang/chapter-1.json   # 章节/小节/边/规则引用
└── ...
```

加载规则：

- 首屏只下载 manifest 和当前教材最小索引，立即渲染章节卡。
- 点击章节时加载该章资源；点击小节时优先使用该章资源中的关系数据。
- 关系图资源按内容 hash 长期缓存，目录版本变更时自动失效。
- 预算目标：根 manifest ≤ 50 KB（gzip），当前教材最小索引 ≤ 250 KB（gzip）；单章图资源目标 ≤ 300 KB（gzip），超出则继续按小节拆分。

### 5.3 构建校验

导出阶段读取 `shared/textbooks.json`、KG 导出文件和 PDF 书签，校验：

- 章节/section 顺序和名称稳定。
- 节点 ID 唯一、教材前缀正确、节点只归属一个小节。
- 边的两端都存在且教材/章节边界合法。
- 关系类型、方向、审核状态符合门禁。
- 页码位于 PDF 范围内。
- 生成内容 hash 和 `catalog_version`；KG、PDF 与已提交目录不一致时构建失败。
- 同一输入重复导出结果稳定（时间字段除外）。

## 6. 前端改造与数据流

### 6.1 新增/扩展模块

- `frontend/src/catalog/types.ts`：增加边、规则引用和 subsection 类型。
- `frontend/src/catalog/loadCatalog.ts`：支持 manifest、教材索引、章节/小节资源的分层加载和版本校验。
- `frontend/src/catalog/catalogData.ts`：提供节点、边、section 的索引 helper。
- `frontend/src/hooks/useLearningProgress.ts`：继续作为用户稀疏进度的唯一运行时来源。
- `frontend/src/components/KnowledgeGraphView.tsx`：小节关系图、筛选、选中态和详情入口。
- `frontend/src/components/NodeDetailPanel.tsx`：节点详情、规则展开和阅读/复习动作。

图布局采用可重复的分层布局：优先按 `PREREQUISITE_OF`、`DERIVES` 的方向排列；无方向或环路关系使用稳定排序放置。实现可选用成熟图组件（推荐 React Flow）或等价 SVG 实现，但必须支持缩放、平移、键盘聚焦和移动端触控，不在组件内手写教材数据。

### 6.2 状态流

```text
catalog store（静态） ─┐
                       ├─→ section 聚合 / graph projection → 页面
progress store（稀疏） ─┘
              ↑
        /learning-progress + SSE progress_delta
```

- `MapHome` 和 drawer 的 `LearningSidebar/ChapterMapView` 共用同一 catalog store 与 progress store。
- 地图启动不得请求 Neo4j 节点结构，不再依赖 `/learning-map/chapters`、`/learning-map/nodes`。
- 后端是 node status 的唯一真相；前端只计算章节统计、继续学习和待巩固列表。
- `revision` 按用户+教材单调递增，完整响应和 SSE 增量都携带 revision；客户端拒绝 `revision <= currentRevision` 的旧响应。
- 问答 evidence 落库后只更新受影响节点及所属章节，不触发整图刷新。

### 6.3 交互细节

- 图上提供“核心知识 / 应用题型”切换和“只看已学习/显示全部”筛选。
- 选中节点时突出一跳邻居，其他节点保持可读但降低视觉权重。
- 小节无关系边时仍显示节点列表，并给出“当前小节暂无可用关系”的明确空状态。
- 关系图加载失败不影响章节总览和 PDF 阅读，可重试单个小节。
- 深色模式、窄屏和长数学名称必须不重叠；节点名称使用现有数学文本渲染组件。

## 7. 用户进度叠加规则

- 进度接口只返回存在 evidence 的节点；静态目录中未命中的节点默认为“未探索”。
- `project_status()` 的窗口、evidence 顺序和 `closed_evidence_count` 语义保持不变，前端不复制该算法。
- 章节聚合按静态节点索引计算：探索数、学习中、基本掌握、已掌握、需巩固。
- “继续学习”优先选择需巩固节点，其次选择学习中节点；没有记录时回到本章首个可读 section。
- 未审核的隐式边不得造成 blocked，也不得改变推荐排序。
- 目录版本更新后只保留能匹配当前 node ID 的进度；孤儿进度留在后端历史中，不显示在地图。
- 匿名登录立即切换身份但保留匿名快照；后台幂等迁移 chat/evidence，成功后重新拉取新账号进度，失败显示“进度同步中”和重试入口。

## 8. 性能、缓存与响应式要求

### 8.1 性能口径

- 缓存命中后章节卡在 100 ms 内可见。
- 地图启动运行时 KG 节点请求为 0。
- 首屏只承担静态资源和一次进度快照请求；冷启动单独记录资源下载耗时。
- 打开小节后关系图首批节点在 300 ms 内可见，完整布局在 1 s 内稳定。
- 问答结束后全图刷新请求为 0。

### 8.2 缓存隔离

进度快照键保持：

```text
learnmath.progress.<user-or-device>.<textbook_id>.<catalog_version>
```

静态资源使用内容 hash 和长期浏览器缓存。教材切换时不得短暂显示上一教材的章节或颜色；主地图和 drawer 读取同一份缓存。

### 8.3 响应式

- 桌面端：章节总览三列，小节图有独立画布和详情侧栏。
- 平板端：章节总览两列，详情面板可改为底部抽屉。
- 移动端：关系图支持双指缩放/拖拽，节点详情使用底部 sheet；所有关键按钮触控高度不小于 44 px。

## 9. 分阶段实施

### Phase A：数据审计与目录扩展

1. 固定核心节点、应用节点、规则节点的白名单。
2. 在 `export_learning_catalog.py` 中导出边、审核元数据、规则引用和 subsection（若源数据存在）。
3. 生成按教材/章节拆分的静态资源，加入 hash、版本和一致性校验。
4. 用四本教材和抽样小节与 Aura 对拍，记录节点/边数量差异。

### Phase B：静态关系图读取层

1. 扩展 catalog 类型和加载器，保持旧字段兼容。
2. 实现小节资源按需加载、版本校验和失败重试。
3. 实现关系语义门禁结果的前端投影，不在浏览器临时推断边类型。

### Phase C：章节详情与节点详情

1. 将 `ChapterMapView` 从扁平节点列表改为章节→小节→关系图入口。
2. 新增 `KnowledgeGraphView` 和 `NodeDetailPanel`。
3. 接入状态颜色、继续/复习、PDF 页码和来源提问动作。
4. 同步 drawer 学习地图，确保不再调用旧地图结构接口。

### Phase D：增量进度与迁移

1. 保持 `/api/learning-progress` 为用户进度接口，补齐 `revision` 和 SSE `progress_delta` 对拍。
2. 删除 `historyVersion → mapHome.refresh()` 的整图刷新路径。
3. 完成匿名身份迁移后的快照隔离和重拉。
4. 旧 `/learning-map/*` 接口保留一个发布周期，确认无调用后再下线。

### Phase E：性能和视觉验收

1. 对四个教材、明暗模式、390/768/1280/1440 视口进行截图走查。
2. 记录 manifest、教材索引、章节图资源大小和冷/热启动耗时。
3. 用真实 KG 抽测关系方向、规则展开和长数学名称布局。

## 10. 测试与验收

### 10.1 构建数据

- 四本教材目录可重复生成，hash 稳定。
- 章节、section、小节、节点和已审核边与 KG/PDF 对拍一致。
- 节点 ID 唯一，跨教材不串线，页码均在范围内。
- 未审核隐式边不会出现在关系图资源或前置索引中。

### 10.2 后端与进度

- `learning-progress` 认证、用户隔离、教材隔离和空 evidence 正确。
- 后端状态投影与旧地图接口在同一 fixture 上自动对拍。
- 同时间戳 evidence 顺序、revision 单调递增和旧响应拒绝有测试。
- SSE `progress_delta` 只包含受影响节点，客户端不触发全图刷新。

### 10.3 前端与 E2E

- 首屏请求中不存在 `/learning-map/chapters`、`/learning-map/nodes`。
- 无进度时章节结构仍立即显示；进度失败不影响静态地图。
- 章节→小节→关系图→节点详情的路径可用，图失败可单独重试。
- 节点状态、应用题型展开、规则条件/结论展开和 PDF 跳转正确。
- 主地图与 drawer 的教材、目录版本、进度和选中状态一致。
- 教材切换、匿名迁移、目录版本变化不串数据。
- 明暗模式及四种视口无文字溢出、节点遮挡或不可操作控件。

## 11. 明确不做的事情

- 不把整章或整本教材强行画成一张力导向图。
- 不把所有辅助规则节点当作普通学习点或进度点。
- 不把 `USES`、`DERIVES` 等普通语义边伪装成前置关系。
- 不用 confidence 单字段决定边是否正确或是否阻断学习。
- 不在前端组件中手写章节、节点和关系数据。
- 不为地图首屏恢复运行时 Neo4j 结构请求。
- 不为了展示“满图效果”隐去未探索节点或修改后端状态语义。

## 12. 待审阅事项

以下事项需要在进入 Phase A 前冻结：

1. KG 当前是否提供稳定的 `subsection_id`；若没有，首版按 `section` 作为最小地图单元。
2. 关系图实现选用 React Flow 还是轻量 SVG；无论选哪种，必须支持缩放、平移、键盘聚焦和移动端触控。
3. `ProblemClass` 默认收起时，是否在小节摘要中显示题型数量。
4. 隐式边审核结果由哪份 `implicit_decisions`/`implicit_edges` 产物作为发布门禁输入。
5. 章节图资源的最终大小阈值和是否需要进一步拆到小节级。

在上述事项冻结前，本文件仅作为设计草稿；确认后再拆分为实现任务、测试任务和发布检查单。
