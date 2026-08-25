export const STORAGE_SCHEMA_VERSION = '2';

export const STORAGE_KEYS = {
  schemaVersion: 'learnmath.storage.schema',
  authToken: 'auth_token',
  deviceId: 'device_id',
  currentTextbook: 'current_textbook',
  pdfPages: 'pdf_viewer_page_v2',
  pdfZoom: 'pdf_view_preferences_v1',
  darkMode: 'learnmath_dark',
  desktopChatCollapsed: 'learnmath.ui.desktopChatCollapsed',
  mobileReaderDock: 'learnmath.mobileReaderDock.v1',
  formulaFavorites: 'formula_favorites',
  formulaHistory: 'formula_history',
  welcomeDismissed: 'learnmath.welcome.dismissed',
} as const;

export function workspaceStorageKey(textbookId: string): string {
  return `learnmath.workspace.${textbookId}`;
}

export function activeThreadStorageKey(userId: string): string {
  return `active_chat_thread:${userId}`;
}

export function progressStorageKey(scope: string, textbookId: string, catalogVersion: string): string {
  return `learnmath.progress.${scope || 'anonymous'}.${textbookId}.${catalogVersion}`;
}
