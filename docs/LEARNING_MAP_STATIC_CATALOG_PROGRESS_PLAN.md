# 学习地图静态教材目录与用户进度分离方案

> 日期：2026-08-18  
> 状态：已实现（静态目录与用户进度链路已落地；旧地图接口保留一个发布周期）
> 范围：地图页启动、章节详情、用户进度同步和地图缓存  
> 不改变：SSE 问答协议、KG 检索语义、evidence 账本规则、PDF 阅读器交互

## 0. 结论

教材的章节、section、知识点、节点关系和 PDF 页码都是教材结构，不随用户变化，不应该在地图启动时从 Neo4j 即时读取。

地图运行时只需要把两类数据叠加：

~~~text
静态教材目录（构建期生成）
          +
用户稀疏学习进度（运行时同步）
          =
当前用户的学习地图
~~~

当前 /api/learning-map/chapters 和 /api/learning-map/nodes 同时承担了“读取教材结构”和“投影用户状态”两件事，导致首屏依赖 Neo4j，并在章节接口完成后继续拉取全部章节节点。本方案将这两个职责拆开。

## 1. 设计目的

### 1.1 用户体验目标

1. 打开地图后先看到完整、正确的教材章节，不等待 Neo4j。
2. 返回用户先看到上次的进度快照，后台再校准最新状态。
3. 用户打开某章时才展开该章知识点，不为未访问章节加载数据。
4. 一次问答结束只更新受影响的节点和章节，不刷新整张地图。
5. 网络或 KG 暂时不可用时，静态地图和 PDF 阅读仍可用。

### 1.2 工程目标

1. 教材结构只有一个构建期数据源，避免前端硬编码、Neo4j 和 PDF 目录三处漂移。
2. 运行时地图请求只读取用户进度，默认不访问 Neo4j。
3. 静态目录可通过版本号和内容哈希缓存，发布新教材时可校验失效。
4. 保留旧地图接口作为迁移和回滚路径，迁移完成后再下线。
5. 已权衡未选方案：后端物化静态结构 + 投影留在服务端也能把首屏压到百毫秒级且不移动投影语义，但给不了零网络渲染与 KG 离线韧性。本方案选择前端静态目录，代价是投影规则在迁移期存在 Python/TS 双实现（收敛路径见 5.3 冻结原则）。

## 2. 当前链路与问题

当前前端 frontend/src/hooks/useMapHomeData.ts 的流程是：

~~~text
认证完成
  -> GET /learning-map/chapters
  -> 后端从 KG 拉每章全部 node_ids
  -> 后端读取用户 evidence 并计算章节状态
  -> 前端立即并发 GET /learning-map/nodes（每一章一次）
  -> 前端等待/渐进合并所有章节节点
~~~

实测上册数据：

| 请求 | 结果 | 备注 |
|---|---:|---|
| /learning-map/chapters?gaodai_shang | 约 1.9 秒 | 6 章、1514 个节点参与结构和状态计算 |
| 6 个 /learning-map/nodes 并发 | 约 2.3 秒 | 用户没有打开任何章节也会全部请求 |

此外，frontend/src/App.tsx 在 historyVersion 变化后调用 mapHome.refresh()，一次问答会重复整张地图的读取链路。

## 3. 数据边界

### 3.1 构建期静态教材数据

以下字段从 KG 和 PDF 目录导出，发布后对所有用户相同：

| 数据 | 用途 |
|---|---|
| 教材 ID、名称、版本 | 教材选择和缓存隔离 |
| 章节 ID、原始章节名、自然顺序 | 章节卡和章节导航 |
| section ID、显示名、顺序 | 章节详情 |
| node ID、名称、类型、所属 section | 知识点列表 |
| 前置 node ID | 受阻状态计算 |
| 章节/section 首页 | 章节和知识点跳转 |
| 节点总数 | 章节卡总量显示 |

“硬编码”指构建期生成并版本化，不是在 TSX 组件里手写章节内容。

### 3.2 运行时用户数据

地图核心只同步以下用户相关字段：

~~~text
node_id
status
closed_evidence_count
last_activity_at
~~~

没有出现在结果里的 node 默认是 unexplored。章节进度、状态分布、继续学习项、待巩固列表和受阻状态由“静态节点索引 + 稀疏进度”计算。

来源提问的 chat_id / 是否可打开属于对话业务，不属于教材目录。它可以作为进度增量的可选字段，或用户点击“来源提问”时单独查询，不能阻塞地图启动。

## 4. 构建期静态目录

### 4.1 生成脚本

新增构建脚本：

~~~text
scripts/export_learning_catalog.py
~~~

脚本读取：

1. shared/textbooks.json 的教材注册信息。
2. KG 的章节、节点、section 和前置关系。
3. PDF 书签及已确认的 section 页码。

脚本输出前先校验：

- 章节自然顺序和章节名稳定。
- node ID 在教材内唯一，且前缀与教材一致。
- 每个 KG 节点只属于一个章节和 section。
- 静态节点数量与 KG 导出数量一致。
- section 页码存在时必须在 PDF 总页数范围内。
- 同一教材重复导出结果除版本字段外稳定。

### 4.2 输出文件

建议输出到：

~~~text
frontend/public/map-catalog/
├── manifest.json
├── gaodai_shang.json
├── gaodai_xia.json
├── gaoshu_shang.json
└── gaoshu_xia.json
~~~

manifest.json 包含教材列表、目录版本、章节摘要以及当前可用教材的最小节点索引，用于首屏快速渲染和章节统计；独立 `.index.json` 仍作为按教材缓存/兼容副本。

为支持首屏章节统计，根 manifest 必须声明当前教材最小节点索引的静态资源路径；该 index 包含 `node_id`、章节 ID、section ID、显示名称和稳定顺序。完整的前置关系及其他详情放在教材或按章静态资源中；前端不能依赖运行时接口才能建立 node 到章节的映射，也不能为当前教材下载其他三本书的索引。

每本教材 JSON 包含完整的章节、section、节点和页码。若文件体积过大，再拆成：

~~~text
map-catalog/gaodai_shang/
├── index.json
├── chapter-1.json
├── chapter-2.json
└── ...
~~~

拆分只影响静态资源组织，不重新引入运行时 KG 请求。

### 4.3 目录版本

每份目录包含：

~~~json
{
  "catalog_version": "gaodai_shang-<content-hash>",
  "textbook_id": "gaodai_shang",
  "generated_at": "2026-08-18T00:00:00Z",
  "chapters": []
}
~~~

目录版本变化时，前端丢弃旧结构缓存；用户进度仍按 node ID 迁移，无法匹配的旧节点只作为历史数据保留，不显示在新目录中。

## 5. 运行时接口方案

### 5.1 新增用户进度接口

新增：

~~~text
GET /api/learning-progress?textbook_id=<id>
~~~

认证仍只从 Bearer token 获取用户 ID。响应只返回用户有 evidence 的节点：

~~~json
{
  "textbook_id": "gaodai_shang",
  "catalog_version": "gaodai_shang-abc123",
  "revision": 19,
  "nodes": {
    "gaodai_shang:node:xxx": {
      "status": "learning",
      "closed_evidence_count": 1,
      "last_activity_at": "2026-08-18T10:20:00"
    }
  }
}
~~~

实现要求：

- 只查询 evidence_turns，不查询 Neo4j。
- 按 user_id + textbook_id 隔离。
- 只返回非 unexplored 节点。
- catalog_version 不匹配时仍返回 node ID 进度，由前端按当前目录过滤。
- revision 用于本地快照和增量校验。

`revision` 按 `user_id + textbook_id` 单调递增。evidence 写入和 revision 更新在同一数据库事务内完成；完整进度响应和 SSE 增量都必须携带 revision，前端只接受大于当前值的响应。多标签页或并发问答返回旧 revision 时不得覆盖新状态。

### 5.2 问答后的增量

SSE 收尾阶段在 evidence 成功落库后返回本次受影响节点的进度增量。前端收到后：

1. 更新当前节点状态。
2. 重新计算所属章节统计。
3. 更新继续学习和待巩固区域。
4. 更新本地进度快照。

不再通过 historyVersion -> mapHome.refresh() 重拉整张地图。

### 5.3 旧接口迁移与投影冻结

现有 /api/learning-map/chapters 和 /api/learning-map/nodes 暂时保留：

- 旧接口继续服务旧客户端和回滚版本。
- 新前端默认使用静态目录 + /learning-progress。
- 旧接口增加日志，确认新前端已不再调用后再下线。

冻结原则（迁移期必须遵守）：

- 后端 `app/services/learning/projection.py` 是 node status 的唯一真相，继续按 evidence 顺序和最近窗口计算状态；前端不复制 `project_status`。
- 前端只负责基于静态节点索引和后端 status 计算章节统计、继续学习、待巩固和展示排序。
- 迁移期状态规则如需调整，先修改后端投影并同步对拍测试，禁止只改前端聚合规则。

关联接口与组件的去留：

- `/api/textbook/section-page` 降级为目录缺页时的运行时 fallback，不再承担地图主链路；Phase E 评估与旧地图接口同期下线。
- drawer 学习地图 tab（`useLearningMap` / `ChapterMapView`）必须同步迁移到静态目录 + /learning-progress；否则旧接口永远有调用方，Phase E 无法完成。

## 6. 前端修改方案

### 6.1 新增静态目录加载层

新增：

~~~text
frontend/src/catalog/types.ts
frontend/src/catalog/loadCatalog.ts
frontend/src/catalog/catalogData.ts
~~~

职责：

- 读取 manifest.json 和当前教材目录。
- 提供稳定的章节、section、node 类型。
- 提供 node ID 到章节/section 的索引。
- 提供 section 到 PDF 页码的映射。
- 对目录版本做校验。

不把章节文字散落到 MapHome.tsx 或 App.tsx。

### 6.2 替换 useMapHomeData

新增 useLearningProgress，负责：

- 读取用户 + 教材维度的本地进度快照。
- 认证完成后请求 /learning-progress。
- 合并服务端最新进度。
- 对外提供节点状态和 revision。
- 提供受影响节点的局部更新方法。

MapHome 接收静态目录和进度投影，不再接收 nodesByChapter 的远程加载结果。

### 6.3 地图首页

启动时：

1. 直接从静态目录渲染所有章节卡。
2. 使用本地进度快照着色；没有快照时显示“进度同步中”。
3. 后台进度响应到达后重新计算章节状态。
4. 继续学习卡先显示“从一页教材开始”，进度到达后替换为实际节点。

章节卡所需的章节名称、数量、排序不再显示 skeleton 等待远程接口。

### 6.4 章节详情

章节节点来自静态目录。点击章节时只做：

- 读取或加载静态章节资源。
- 使用当前进度投影显示状态。
- 根据静态页码直接进入阅读器。

点击“来源提问”时再加载对话记录，不阻塞章节详情。

### 6.5 App 刷新逻辑

删除或改造：

~~~text
chat.historyVersion -> mapHome.refresh()
~~~

替换为：

~~~text
SSE evidence delta -> progressStore.applyDelta(delta)
~~~

手动“刷新地图”只刷新用户进度接口，不重新读取教材结构。

## 7. 本地缓存和身份迁移

### 7.1 缓存键

用户进度快照按以下维度隔离：

~~~text
learnmath.progress.<userId-or-deviceId>.<textbookId>.<catalogVersion>
~~~

静态目录由浏览器 HTTP 缓存控制，发布时使用内容哈希文件名或 immutable 缓存策略。

### 7.2 匿名到登录

匿名用户登录后沿用现有 evidence/chat 迁移流程，并同步迁移或重建进度快照：

1. 旧匿名快照保留为回滚用。
2. 登录成功后立即切换到新用户身份，不把匿名快照显示到新账号。
3. 后台以幂等方式重试 chat/evidence 迁移；迁移期间显示“进度同步中”。
4. 迁移成功后重新读取新用户进度；失败时保留匿名快照并提供重试入口。

### 7.3 失败和过期

- 静态目录加载失败：显示教材加载错误和重试入口。
- 进度接口失败：继续使用本地快照，标记“进度暂未同步”。
- 进度快照版本过旧：先显示旧状态，再后台覆盖。
- 目录版本变化：按当前 node ID 过滤旧进度，禁止旧节点污染新地图。

## 8. 分阶段实施

### Phase A：导出和校验静态目录

- 实现 scripts/export_learning_catalog.py。
- 生成四本教材目录。
- 加入 KG/PDF 一致性校验。
- 再生成工作流（本项目无 CI，落地为两条具体动作）：
  - KG 重新导入或教材变更后必须重跑导出脚本并提交更新后的目录文件；`start.bat`/部署文档加入提醒。
  - 共享生成产物 `shared/generated/learning_catalog_manifest.json` 同时提供前后端使用的 `catalog_version`；前端 public 目录只是其发布副本。
  - KG/PDF 与已提交目录不一致时重新导出并修正目录；校验仍失败则阻断构建或部署，不允许带错误目录发布。

交付标准：四本教材章节、section、节点数量和页码与当前真实数据一致。

### Phase B：前端静态地图并行接入

- 新增 catalog loader 和类型。
- MapHome 改为读取静态目录。
- 暂时继续调用旧接口，仅用于对照验证状态。
- 增加静态目录与旧接口结构差异日志。

交付标准：首屏章节结构不依赖后端；旧接口故障不影响章节卡显示。

### Phase C：新增进度接口

- 实现 /learning-progress。
- 为 evidence 查询增加 `user_id + textbook_id + created_at` 索引和测试。
- 前端使用进度接口覆盖静态节点状态。

交付标准：进度状态与旧 /learning-map 结果一致——落成自动化对拍测试：同一 evidence fixture 分别走「旧 /learning-map 接口」与「静态目录 + /learning-progress」两条链路，断言节点状态、章节统计、继续学习与待巩固投影相等；用户和教材隔离测试通过。

### Phase D：增量更新和按需对话

- SSE 收尾增加 progress delta。
- 删除问答后的整图刷新。
- 来源提问改为显式按需加载。

交付标准：一次问答只更新受影响节点，Network 面板不再出现全章/全图请求。

### Phase E：下线运行时 KG 地图读取

- 新前端稳定运行后，旧接口停止被前端调用。
- 保留后端接口一个发布周期用于兼容和回滚。
- 删除无调用的前端请求代码和不再需要的状态字段。

## 9. 测试与验收

### 9.1 构建数据测试

- 四本教材目录都能生成。
- 章节自然排序正确。
- 节点 ID 无重复、无跨教材前缀。
- 每个 section 页码与 PDF 书签或扫描抽测一致。
- 导出结果重复运行稳定。

### 9.2 后端测试

- 未认证不能读取用户进度。
- user_id 只来自 token，不能由查询参数覆盖。
- 用户和教材隔离。
- 空 evidence 返回空节点集合，前端显示全部未探索。
- revision 和 catalog version 正确返回。
- 进度接口不调用 KG。
- evidence 新增后只影响对应 node 和 chapter。

### 9.3 前端测试

- 首次打开地图时章节卡先于进度接口显示。
- 地图启动 Network 中没有 /learning-map/nodes 全章请求。
- 切换教材不会短暂显示上一教材章节或进度。
- 返回用户先显示本地快照，服务端进度到达后正确覆盖。
- 点击章节只加载该章节静态资源。
- “继续”跳到静态 section 页；“来源提问”才打开历史对话页。
- 问答完成后只更新一个节点和其章节统计。
- 进度接口失败时静态地图和阅读入口仍可用。
- catalog version 变化时旧节点进度不会污染新目录。

### 9.4 性能目标

| 指标 | 当前 | 目标 |
|---|---:|---:|
| 首次出现章节卡 | 约等待 1.9 秒 | JS 加载后 100ms 内，不依赖 API |
| 用户进度首次校准 | 约 1.9 秒地图请求 | 单一轻量请求，目标 300ms 内 |
| 地图启动节点请求 | 6 个 /nodes | 0 个运行时 KG 节点请求 |
| 问答后的地图请求 | 全量刷新 | 0 个全量请求，仅本地增量更新 |

## 10. 非目标和边界

本方案不做以下事情：

- 不把用户 evidence 写入静态目录。
- 不把用户状态硬编码进前端构建产物。
- 不在前端复制 LLM 的 KG 检索逻辑。
- 不改变 evidence 的 outcome 定义和自评链路。
- 不在本阶段把 section 列表改造成关系图可视化。

## 11. 最终业务链路

~~~text
构建阶段：KG + PDF
  -> 导出版本化教材目录
  -> 前端发布并由浏览器缓存

运行阶段：
  静态目录 + 本地进度快照
  -> 立即显示地图
  -> 后台同步用户稀疏进度
  -> 前端计算章节状态
  -> 用户点击后读取对应静态章节
  -> 问答完成后用 progress delta 局部更新
~~~

完成后，地图页的教材结构完全是本地静态数据，运行时只处理用户学习进度；Neo4j 不再成为地图启动性能的依赖。
