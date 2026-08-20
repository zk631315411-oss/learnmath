# components/ 组件目录

通用 React 展示组件。职责分层：页面骨架与交互在 App.tsx；教材渲染（PDFViewer/PageMarker）、聊天（PageNotesPanel/ChatPanel/AgentActivity）、截图（ScreenCapture/CaptureBubble/ImageCropper）、认证（AuthModal/AuthControls）、公式（formula/ 子目录）与引导/记录面板（EmptyGuideCard/QuestionListPanel）。

思路变动：三处空态收敛为 EmptyGuideCard 三步引导卡（2026-08，P3-13）；移动端聊天入口改为布局流内的 BottomSheet 三档把手栏，框选首问由 CaptureBubble 原地完成；公式组件归入 formula/ 子目录（P2-10）。
