import { CheckCircle2, LoaderCircle, X } from 'lucide-react';
import { useState } from 'react';
import { submitFeedback } from '../services/api';

export type FeedbackValues = {
  rating: number;
  most_used_feature: string;
  disappointing_feature: string;
  disappointing_reason: string;
  problem_description: string;
  recommend: string;
  suggestion: string;
  contact: string;
};

interface Props {
  token?: string;
  onClose: () => void;
}

const inputClass = 'w-full rounded-lg border border-[var(--lm-border)] bg-[var(--lm-bg)] px-3 py-2.5 text-sm text-[var(--lm-text)] outline-none transition focus:border-[var(--lm-brand)] focus:ring-2 focus:ring-[var(--lm-brand)]/20';
const initialValues: FeedbackValues = { rating: 0, most_used_feature: '', disappointing_feature: '', disappointing_reason: '', problem_description: '', recommend: '', suggestion: '', contact: '' };

export default function FeedbackForm({ token, onClose }: Props) {
  const [values, setValues] = useState<FeedbackValues>(initialValues);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const update = (key: keyof FeedbackValues, value: string | number) => setValues(previous => ({ ...previous, [key]: value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!values.rating) { setError('请先选择整体体验评分'); return; }
    setSubmitting(true); setError('');
    try {
      await submitFeedback({ ...values, page_url: window.location.href }, token);
      setSubmitted(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '提交失败，请稍后重试');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
      <div className="relative max-h-[min(820px,calc(100dvh-24px))] w-full max-w-xl overflow-y-auto rounded-2xl border border-[var(--lm-border)] bg-[var(--lm-surface)] shadow-2xl">
        <button type="button" onClick={onClose} aria-label="关闭反馈问卷" title="关闭" className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-[var(--lm-text-muted)] hover:bg-[var(--lm-canvas)]"><X className="h-5 w-5" /></button>
        {submitted ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center px-6 py-12 text-center">
            <CheckCircle2 className="h-12 w-12 text-[var(--lm-success)]" />
            <h2 id="feedback-title" className="mt-4 text-xl font-bold text-[var(--lm-text-strong)]">感谢你的反馈</h2>
            <p className="mt-2 text-sm text-[var(--lm-text-muted)]">反馈已经提交，我们会将它用于后续改进。</p>
            <button type="button" onClick={onClose} className="mt-6 rounded-lg bg-[var(--lm-brand)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--lm-brand-strong)]">关闭</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 p-5 sm:p-7">
            <div className="pr-8"><p className="text-xs font-semibold tracking-wide text-[var(--lm-brand)]">内测反馈</p><h2 id="feedback-title" className="mt-1 text-xl font-bold text-[var(--lm-text-strong)]">告诉我们你的使用感受</h2><p className="mt-1 text-sm text-[var(--lm-text-muted)]">带 * 的项目为必填，其余内容按你的方便程度填写即可。</p></div>
            <fieldset><legend className="mb-2 text-sm font-medium text-[var(--lm-text)]">整体体验评分 *</legend><div className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5].map(score => <label key={score} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${values.rating === score ? 'border-[var(--lm-brand)] bg-[var(--lm-brand)]/10 text-[var(--lm-brand)]' : 'border-[var(--lm-border)] text-[var(--lm-text-muted)]'}`}><input className="sr-only" type="radio" name="rating" value={score} checked={values.rating === score} onChange={() => update('rating', score)} />{score} 分</label>)}</div></fieldset>
            <label className="block text-sm text-[var(--lm-text)]">最常使用的功能<select className={inputClass + ' mt-1'} value={values.most_used_feature} onChange={event => update('most_used_feature', event.target.value)}><option value="">请选择</option><option>教材阅读</option><option>智能问答</option><option>学习地图</option><option>公式工具</option><option>提问记录</option><option>Manim 动画</option><option>都差不多/还没深入用</option></select></label>
            <label className="block text-sm text-[var(--lm-text)]">最失望的功能<select className={inputClass + ' mt-1'} value={values.disappointing_feature} onChange={event => update('disappointing_feature', event.target.value)}><option value="">请选择</option><option>教材阅读</option><option>智能问答</option><option>学习地图</option><option>公式工具</option><option>提问记录</option><option>Manim 动画</option><option>都差不多</option><option>其他</option></select></label>
            <label className="block text-sm text-[var(--lm-text)]">失望的原因<textarea className={inputClass + ' mt-1'} rows={2} value={values.disappointing_reason} onChange={event => update('disappointing_reason', event.target.value)} maxLength={1000} /></label>
            <label className="block text-sm text-[var(--lm-text)]">遇到的问题或异常<textarea className={inputClass + ' mt-1'} rows={3} value={values.problem_description} onChange={event => update('problem_description', event.target.value)} maxLength={2000} /></label>
            <fieldset><legend className="mb-2 text-sm font-medium text-[var(--lm-text)]">你愿意推荐给同学吗？</legend><div className="flex flex-wrap gap-2">{['会', '还不确定', '不会'].map(option => <label key={option} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${values.recommend === option ? 'border-[var(--lm-brand)] bg-[var(--lm-brand)]/10 text-[var(--lm-brand)]' : 'border-[var(--lm-border)] text-[var(--lm-text-muted)]'}`}><input className="sr-only" type="radio" name="recommend" value={option} checked={values.recommend === option} onChange={() => update('recommend', option)} />{option}</label>)}</div></fieldset>
            <label className="block text-sm text-[var(--lm-text)]">改进建议<textarea className={inputClass + ' mt-1'} rows={3} value={values.suggestion} onChange={event => update('suggestion', event.target.value)} maxLength={2000} /></label>
            <label className="block text-sm text-[var(--lm-text)]">联系方式（可选）<input className={inputClass + ' mt-1'} value={values.contact} onChange={event => update('contact', event.target.value)} maxLength={200} /></label>
            {error && <p className="text-sm text-red-600 dark:text-red-300" role="alert">{error}</p>}
            <div className="flex flex-col-reverse gap-2 border-t border-[var(--lm-border)] pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm text-[var(--lm-text-muted)] hover:bg-[var(--lm-canvas)]">稍后填写</button><button type="submit" disabled={submitting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--lm-brand)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--lm-brand-strong)] disabled:cursor-not-allowed disabled:opacity-60">{submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}提交反馈</button></div>
          </form>
        )}
      </div>
    </div>
  );
}
