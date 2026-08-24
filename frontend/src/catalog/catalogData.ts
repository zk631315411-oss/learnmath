import type { ChapterMapItem, LearningMapNode, NodeMapResponse, StatusCounts } from '../services/api';
import type { CatalogChapter, CatalogNode, CatalogNodeIndexItem, CatalogChapterSummary } from './types';

export type ProgressNode = {
  status: LearningMapNode['status'];
  closed_evidence_count: number;
  last_activity_at?: string | null;
  source_chat_id?: string | null;
};

export type ProgressMap = Record<string, ProgressNode>;

export function nodeFromCatalog(node: CatalogNode | CatalogNodeIndexItem, progress: ProgressMap): LearningMapNode {
  const state = progress[node.node_id];
  const status = state?.status || 'unexplored';
  const prerequisiteIds = 'prerequisite_ids' in node ? node.prerequisite_ids : [];
  const blocked = status !== 'needs_review' && prerequisiteIds.length > 0
    && prerequisiteIds.every(id => (progress[id]?.status || 'unexplored') === 'needs_review');
  return {
    node_id: node.node_id,
    name: node.name,
    type: 'type' in node ? node.type || 'concept' : 'concept',
    order: node.order,
    page: 'page' in node ? node.page ?? null : null,
    section: node.section,
    status,
    closed_evidence_count: state?.closed_evidence_count || 0,
    blocked,
    chat: { id: state?.source_chat_id || null, available: Boolean(state?.source_chat_id) },
  };
}

export function chapterMapFromCatalog(chapter: CatalogChapter, progress: ProgressMap): NodeMapResponse {
  return {
    textbook_id: chapter.id.split(':chapter:')[0],
    chapter: chapter.name,
    sections: chapter.sections.map(section => ({
      section: section.name,
      page: section.page,
      nodes: section.nodes.map(node => nodeFromCatalog(node, progress)),
    })),
  };
}

export function chapterMapFromIndex(textbookId: string, chapter: CatalogChapterSummary, nodes: CatalogNodeIndexItem[], progress: ProgressMap): NodeMapResponse {
  const groups = new Map<string, CatalogNodeIndexItem[]>();
  nodes.filter(node => node.chapter === chapter.name).forEach(node => {
    const list = groups.get(node.section) || [];
    list.push(node);
    groups.set(node.section, list);
  });
  return {
    textbook_id: textbookId,
    chapter: chapter.name,
    sections: [...groups.entries()].map(([section, sectionNodes]) => ({ section, nodes: sectionNodes.map(node => nodeFromCatalog(node, progress)) })),
  };
}

export function chapterSummary(chapter: CatalogChapterSummary, nodes: Array<CatalogNode | CatalogNodeIndexItem>, progress: ProgressMap): ChapterMapItem {
  const counts: StatusCounts = { unexplored: 0, learning: 0, basically_mastered: 0, mastered: 0, needs_review: 0 };
  nodes.forEach(node => { counts[nodeFromCatalog(node, progress).status] += 1; });
  return {
    chapter: chapter.name,
    node_count: chapter.node_count,
    status_counts: counts,
    exploration_progress: { explored: chapter.node_count - counts.unexplored, total: chapter.node_count },
  };
}
