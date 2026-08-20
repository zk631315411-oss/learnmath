# 学生账号真实 LLM 测试记录（2026-08-19）

## 1. 测试范围

- 测试账号：`kz`（密码见 `STUDENT_TEST_ACCOUNT_RULES.md`）
- 教材：`gaodai_shang`
- PDF 页码：26
- 对话 ID：`4e5faca3-3f03-4ca3-aa93-0b7e4400c891`
- 测试方式：调用前端使用的登录、聊天和 SSE 问答接口；本轮浏览器自动化运行时不可用，因此没有进行鼠标级页面操作。
- 模型：真实 LLM，未使用 mock，未直接插入 evidence。

## 2. 测试前基线

```text
chat_history: 0
evidence_turns: 0
gaodai_shang revision: 0
```

## 3. 学生对话过程

测试主题：为什么初等行变换不改变线性方程组的解集。

1. 学生要求采用苏格拉底式引导，不直接公布答案。
2. 学生指出关键是可逆性：每种初等行变换都有逆变换，因此变换前后的解双向对应。
3. 学生对行倍加写出 `E = I + k e_i e_j^T` 和 `E^-1 = I - k e_i e_j^T`。
4. 学生完成双向证明：`Ax=b => EAx=Eb`；反向左乘 `E^-1`，得到 `EAx=Eb => Ax=b`。

模型明确确认最后的证明完整，随后继续询问如何推广到交换两行和非零倍乘某一行。四轮 SSE 均正常结束，没有 `error` 事件。

```text
第 1 轮：约 15.3s
第 2 轮：约 8.7s
第 3 轮：约 5.4s
第 4 轮：约 4.1s
```

说明：首次命令行请求未显式指定 UTF-8，导致 `chat_history` 的中文展示字段出现乱码。数据库中的问题、回答和追问字段已按本节语义重建；原模型逐字输出无法从含替换字符的数据中无损恢复。evidence、节点 ID、时间、对话 ID 和 revision 未修改。

## 4. Evidence 与进度结果

第 1 轮产生两条真实 evidence：

```text
node_id: gaodai_shang:norm-app-node:c5d24eb8d30264
outcome: unresolved

node_id: gaodai_shang:node:b6ba17ab5f52
outcome: unresolved
```

两条记录均满足：

```text
chat_id: 4e5faca3-3f03-4ca3-aa93-0b7e4400c891
report_path: evidence_fork
created_at: 非空
```

进度变化：

```text
revision: 0 -> 1
两个节点 status: learning
两个节点 closed_evidence_count: 0
```

第 2 至第 4 轮均返回 `progress_delta: null`，没有新增 closed evidence。

## 5. 验收结论

部分通过。

- 通过：真实账号登录、真实 LLM 教学对话、SSE 输出、首轮 evidence 落库、chat 关联、时间戳和 revision 增长均正常。
- 未通过：学生已经给出完整证明且模型明确认可后，链路仍未产生 closed evidence，学习节点停留在 `learning`。
- 判断：教学对话本身可用，但“对话中确认掌握并闭合学习进度”的核心验收尚未通过。后续应单独诊断后续轮次为何没有可评价节点上下文或没有触发 evidence fork；本次测试不直接修改闭合逻辑。
