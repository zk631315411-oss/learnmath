# components/ 组件目录

通用 React 展示组件。职责分层：页面骨架与交互在 App.tsx；教材渲染（PDFViewer/PageMarker）、聊天（ChatPanel/AiBall/AgentActivity）、截图（ScreenCapture/ImageCropper）、认证（AuthModal/AuthControls）、公式（formula/ 子目录）与引导/记录面板（EmptyGuideCard/QuestionListPanel）。

思路变动：三处空态收敛为 EmptyGuideCard 三步引导卡（2026-08，P3-13）；移动端聊天入口收敛为 AiBall 单入口、删除 MobileChatPanel（P1）；公式组件归入 formula/ 子目录（P2-10）。
