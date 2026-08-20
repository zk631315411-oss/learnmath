import { loadJSON, saveJSON } from './storage';

export type WorkspaceView = 'map' | 'reader';

export interface WorkspaceState {
  view: WorkspaceView;
  page: number;
  updatedAt: number;
}

const KEY_PREFIX = 'learnmath.workspace.';

export function loadWorkspace(textbookId: string): WorkspaceState | null {
  if (!textbookId) return null;
  const value = loadJSON<Partial<WorkspaceState> | null>(`${KEY_PREFIX}${textbookId}`, null);
  if (!value || (value.view !== 'map' && value.view !== 'reader')) return null;
  const page = Number(value.page);
  return {
    view: value.view,
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
    updatedAt: Number(value.updatedAt) || 0,
  };
}

export function saveWorkspace(textbookId: string, state: Pick<WorkspaceState, 'view' | 'page'>): void {
  if (!textbookId) return;
  saveJSON(`${KEY_PREFIX}${textbookId}`, {
    view: state.view,
    page: Math.max(1, Math.floor(state.page || 1)),
    updatedAt: Date.now(),
  } satisfies WorkspaceState);
}
