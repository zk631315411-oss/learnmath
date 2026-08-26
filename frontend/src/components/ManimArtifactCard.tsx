import { useEffect, useState } from 'react';
import { CircleAlert, Film, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import type { ManimArtifact } from '../types';
import { getManimArtifact, retryManimArtifact } from '../services/api';

interface Props {
  artifact: ManimArtifact;
  token?: string | null;
  onChange?: (artifact: ManimArtifact) => void;
}

const ACTIVE = new Set<ManimArtifact['status']>(['queued', 'running', 'repair_pending', 'repairing']);

function statusLabel(status: ManimArtifact['status']): string {
  if (status === 'queued') return '等待渲染';
  if (status === 'running') return '正在渲染';
  if (status === 'repair_pending' || status === 'repairing') return '正在自动修复';
  if (status === 'completed') return '教学动画';
  return '动画生成失败';
}

export default function ManimArtifactCard({ artifact, token, onChange }: Props) {
  const [current, setCurrent] = useState(artifact);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => setCurrent(artifact), [artifact]);

  useEffect(() => {
    if (!token || !ACTIVE.has(current.status)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getManimArtifact(current.id, token);
        if (!cancelled) {
          setCurrent(next);
          onChange?.(next);
        }
      } catch {
        // Transient status failures should not replace the answer with an error.
      }
    };
    const timer = window.setInterval(poll, 2000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [current.id, current.status, onChange, token]);

  const retry = async () => {
    if (!token || retrying) return;
    setRetrying(true);
    try {
      const next = await retryManimArtifact(current.id, token);
      setCurrent(next);
      onChange?.(next);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div data-testid={`manim-artifact-${current.id}`} className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="flex min-h-11 items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
        {ACTIVE.has(current.status) ? (
          <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-indigo-500" aria-hidden="true" />
        ) : current.status === 'failed' ? (
          <CircleAlert className="h-4 w-4 shrink-0 text-rose-500" aria-hidden="true" />
        ) : (
          <Film className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{current.title}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{statusLabel(current.status)}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500" aria-label="AI生成内容" title="AI生成内容">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          <span>AI生成</span>
        </span>
        {current.status === 'failed' && token ? (
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-700 dark:hover:text-slate-100"
            aria-label="重新生成动画"
            title="重新生成动画"
          >
            <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
          </button>
        ) : null}
      </div>
      {current.status === 'completed' && current.video_url ? (
        <video
          className="block aspect-video w-full bg-black object-contain"
          controls
          preload="metadata"
          poster={current.poster_url || undefined}
          src={current.video_url}
        />
      ) : current.status === 'failed' ? (
        <p className="px-3 py-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
          {current.error_message || '动画未能生成，文字与公式回答仍可正常使用。'}
        </p>
      ) : (
        <div className="flex aspect-video items-center justify-center bg-slate-100 text-xs text-slate-400 dark:bg-slate-950/70 dark:text-slate-500">
          渲染完成后会自动显示
        </div>
      )}
      <p className="border-t border-slate-200 px-3 py-2 text-xs leading-5 text-slate-500 dark:border-slate-700 dark:text-slate-400">
        {current.rationale || '用于辅助理解的教学示意，不代替证明或精确仿真。'}
      </p>
    </div>
  );
}
