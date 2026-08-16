# hooks/ 状态逻辑目录

跨组件复用的状态与交互逻辑。useChat（SSE 问答/待发截图/未读计数，落库与新建线程携带 textbook_id）、useMarkers（徽标与对话线程，按教材过滤徽标）、useQuestionList（按页提问记录侧栏数据，按教材过滤侧栏）、useSelectionAdjust（截图选区确认态拖移/缩放纯逻辑）、useDarkMode（全局暗色主题：手动偏好持久化，未选择时跟随系统）、useAuth/useTextbookPreference（会话与偏好）。

约定：hook 不直接操作 DOM；外部调用（API）的错误在 hook 内兜底，不让异常炸到组件层。
