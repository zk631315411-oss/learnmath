import { ListTree, Map, X } from 'lucide-react';

import type { Marker } from './PageMarker';
import type { ChapterMapItem, NodeMapResponse } from '../services/api';
import LearningMapPanel from './LearningMapPanel';
import QuestionListPanel from './QuestionListPanel';

export type SidebarTab = 'questions' | 'map';

export default function LearningSidebar(props: {
  tab: SidebarTab; onTabChange: (tab: SidebarTab) => void; onClose?: () => void;
  questions: Marker[]; questionsLoading: boolean; onSelectQuestion: (marker: Marker) => void;
  chapters: ChapterMapItem[]; chapterMap: NodeMapResponse | null; mapLoading: boolean; mapUnavailable: boolean;
  textbookSelected: boolean; onRefreshMap: () => void; onOpenChapter: (chapter: string) => void; onBack: () => void; onOpenChat: (id: string) => void;
}) {
  return <div className="flex h-full flex-col">
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-slate-200 px-2 dark:border-slate-700">
      <button type="button" onClick={() => props.onTabChange('questions')} className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded text-xs font-medium ${props.tab === 'questions' ? 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-700/50'}`}><ListTree className="h-3.5 w-3.5" />问题</button>
      <button type="button" onClick={() => props.onTabChange('map')} className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded text-xs font-medium ${props.tab === 'map' ? 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-700/50'}`}><Map className="h-3.5 w-3.5" />学习地图</button>
      {props.onClose && <button type="button" onClick={props.onClose} aria-label="关闭侧栏" title="关闭侧栏" className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>}
    </div>
    <div className="min-h-0 flex-1">
      {props.tab === 'questions' ? <QuestionListPanel items={props.questions} loading={props.questionsLoading} onSelect={props.onSelectQuestion} /> : <LearningMapPanel chapters={props.chapters} chapterMap={props.chapterMap} loading={props.mapLoading} unavailable={props.mapUnavailable} textbookSelected={props.textbookSelected} onRefresh={props.onRefreshMap} onOpenChapter={props.onOpenChapter} onBack={props.onBack} onOpenChat={props.onOpenChat} />}
    </div>
  </div>;
}
