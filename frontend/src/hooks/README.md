# hooks/ 状态逻辑目录

跨组件复用的状态与交互逻辑。useChat（SSE 问答/待发截图/未读计数）、useMarkers（徽标与对话线程）、useQuestionList（按页提问记录侧栏数据）、useSelectionAdjust（截图选区确认态拖移/缩放纯逻辑）、useAuth/useTextbookPreference（会话与偏好）。

约定：hook 不直接操作 DOM；外部调用（API）的错误在 hook 内兜底，不让异常炸到组件层。
