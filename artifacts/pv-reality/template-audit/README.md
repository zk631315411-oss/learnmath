# 样板账号审计与合并模板

审计时间：2026-08-27

## 保护措施

审计前已对本地主库做只读快照：

`D:\LearnMath\artifacts\pv-reality\snapshots\template-audit-pre-20260827-162742.db`

原库与快照 SHA-256 均为 `C8D682E34B0FD504A43F3BA84B0711FF8DD16C3D45A94A8E875B79E2975E084A`。原库没有被写入，正式 PV 账号未纳入合并。

## 样板候选

| 账号 | 对话 | 证据 | 节点估计 | Manim | 结论 |
|---|---:|---:|---:|---:|---|
| `student_solid` | 0 | 26 | 16 | 0 | 有结构化学习证据，适合作为较强样本 |
| `student_struggle` | 0 | 30 | 17 | 0 | 有较多 unresolved/learning 证据，适合作为薄弱样本 |
| `kz` | 7 | 25 | 3 | 3 | 有知识图谱问答和动画链路；已剔除失败记录，需注意其历史为测试/录制账号 |
| `tester_qa` | 4 | 0 | 0 | 3 | 有完整问答和成功动画，可补充功能演示 |

其他匿名账号只有零散 0–3 条证据或无学习数据，未纳入模板。

## 清理范围（仅合并副本）

- 删除 `kz` 的取消对话：`644bfe67-8a43-4623-b368-deab385b54cc`（`generation_status=cancelled`）。
- 删除失败 Manim：
  - `851e948c-a279-4346-b4dd-88872d63218c`（`busy`）
  - `e66e8284-9b45-45ae-8f77-e03b83d938c8`（`dispatch_failed`）
  - `ea0c87ac-2d41-4670-8478-5f2436080209`（`dispatch_failed`）
- 样板证据中有 80 条历史 `chat_id` 指向已不存在的聊天行；另有 1 条成功 Manim 记录指向历史 E2E 聊天标识。未删除证据或成功动画，只在合并副本中清空这些悬空 `chat_id`，使模板完整性检查通过。
- `unresolved` 证据不是系统错误，全部保留。

## 合并产物

- 独立数据库副本：`merged-sample-template.db`
- 全量发布数据库副本：`learning-release.db`（在完整本地库副本上清理样板错误并生成十个测试账号）
- 机器可读报告：`merged-sample-template.report.json`
- 可重复执行脚本：`merge_sample_templates.py`
- 测试账号种子脚本：`scripts/seed_test_accounts.py`

合并副本中的有效数据汇入既有 `merged_test` 账号：10 条成功对话、81 条证据、3 条成功 Manim、19 个节点估计、1 条学习进度修订。节点估计的计数按来源累加并标记 `stale=1`，首次使用时应通过正常 learner-model 管线重算，避免把聚合值当作最终推断。

## 测试账号模板

已在本审计副本中以 `merged_test` 为源生成 `test_001`–`test_010`：每个账号使用新的 UUID、独立的 `device_id` 和 `123456` 密码哈希，用户级聊天、证据、动画、学习状态均已重映射并通过隔离检查。生成报告见同目录的 `merged-sample-template.db.test-accounts.json`；用于服务器全量同步的副本为 `learning-release.db`，对应报告为 `learning-release.report.json` 和 `learning-release.db.test-accounts.json`。

如需在另一份发布数据库重建账号：

```powershell
python .\scripts\seed_test_accounts.py `
  --database .\path\to\learning.db
```

脚本默认拒绝覆盖已有目标账号；只有明确需要重建时才传 `--replace`。不要把审计副本直接覆盖开发主库，部署前先完成备份并在发布包中核对数据库 SHA-256。
