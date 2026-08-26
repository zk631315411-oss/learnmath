import { ListTree, X } from 'lucide-react';

import type { Marker } from './PageMarker';
import QuestionListPanel from './QuestionListPanel';

export default function LearningSidebar(props: {
  onClose?: () => void;
  questions: Marker[]; questionsLoading: boolean; onSelectQuestion: (marker: Marker) => void;
  pageSections?: Record<string, string>;
  onRenamed?: () => void;
  onDeleteQuestion?: (marker: Marker) => void | Promise<void>;
}) {
  return <div className="flex h-full flex-col">
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200 px-3 dark:border-slate-700">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-800 dark:text-slate-100">
        <ListTree className="h-3.5 w-3.5" />提问记录
      </div>
      {props.onClose && <button type="button" onClick={props.onClose} aria-label="关闭侧栏" title="关闭侧栏" className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>}
    </div>
    <div className="min-h-0 flex-1">
      <QuestionListPanel items={props.questions} loading={props.questionsLoading} onSelect={props.onSelectQuestion} pageSections={props.pageSections} onRenamed={props.onRenamed} onDelete={props.onDeleteQuestion} />
    </div>
  </div>;
}
