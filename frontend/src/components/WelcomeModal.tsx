import { ArrowRight, Check, ExternalLink, MessageSquare, X } from 'lucide-react';

interface Props {
  onClose: () => void;
  onDismiss: () => void;
  onOpenFeedback: () => void;
}

export default function WelcomeModal({ onClose, onDismiss, onOpenFeedback }: Props) {
  return (
    <div className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="relative max-h-[min(680px,calc(100dvh-32px))] w-full max-w-xl overflow-y-auto rounded-xl border border-[var(--lm-border)] bg-[var(--lm-surface)] shadow-2xl">
        <button type="button" onClick={onClose} aria-label="关闭欢迎说明" title="关闭" className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-lg text-[var(--lm-text-muted)] hover:bg-[var(--lm-canvas)] hover:text-[var(--lm-text)]">
          <X className="h-5 w-5" />
        </button>
        <div className="p-5 sm:p-6">
          <div className="flex items-center gap-3 pr-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-[var(--lm-canvas)] p-1.5">
              <img src="/mascot/fox.png" alt="学数有道狐狸助手" className="max-h-14 w-auto object-contain" />
            </div>
            <div className="min-w-0">
              <p className="mb-0.5 text-xs font-semibold tracking-wide text-[var(--lm-brand)]">学数有道内测</p>
              <h2 id="welcome-title" className="text-xl font-bold text-[var(--lm-text-strong)] sm:text-2xl">欢迎来试用学数有道</h2>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-[var(--lm-text-muted)]">这是一个围绕教材、知识地图和 AI 答疑打造的学习工作台。你的真实使用反馈会直接帮助我们改进产品。</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {['沿教材章节定位知识点', '通过文字、截图和公式提问', '查看学习地图与学习记录'].map(item => (
              <div key={item} className="flex items-start gap-2 rounded-lg bg-[var(--lm-bg)] px-2.5 py-2 text-xs leading-5 text-[var(--lm-text)]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lm-success)]" />{item}</div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-[var(--lm-border)] bg-[var(--lm-bg)] p-3 text-sm text-[var(--lm-text)]">
              <p className="font-semibold text-[var(--lm-text-strong)]">内测账号</p>
              <p className="mt-1 text-xs leading-5 text-[var(--lm-text-muted)]">可直接使用 <code className="rounded bg-[var(--lm-canvas)] px-1">test_001</code> 至 <code className="rounded bg-[var(--lm-canvas)] px-1">test_010</code>，统一密码为 <code className="rounded bg-[var(--lm-canvas)] px-1">123456</code>。</p>
            </div>
            <div className="rounded-lg border border-dashed border-[var(--lm-border)] p-3 text-sm text-[var(--lm-text-muted)]">
              <div className="flex items-center gap-2 font-medium text-[var(--lm-text)]"><ExternalLink className="h-4 w-4" />产品预览视频</div>
              <p className="mt-1 text-xs">视频入口正在准备中，可先直接体验核心功能。</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-[var(--lm-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <button type="button" onClick={onOpenFeedback} className="inline-flex items-center justify-center gap-2 text-sm font-medium text-[var(--lm-brand)] hover:underline"><MessageSquare className="h-4 w-4" />填写内测反馈</button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <button type="button" onClick={onDismiss} className="px-3 py-2 text-xs text-[var(--lm-text-muted)] hover:text-[var(--lm-text)]">不再显示</button>
            <button type="button" onClick={onClose} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--lm-brand)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--lm-brand-strong)]"><span>开始体验</span><ArrowRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
