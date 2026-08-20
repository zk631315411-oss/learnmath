import { useCallback, useEffect, useState } from 'react';
import { getLearningProgress, type LearningProgressResponse } from '../services/api';
import type { ProgressMap } from '../catalog/catalogData';

type StoredProgress = LearningProgressResponse;
const store = new Map<string, StoredProgress>();
const listeners = new Map<string, Set<() => void>>();

function key(scope: string, textbookId: string, catalogVersion: string): string {
  return `learnmath.progress.${scope || 'anonymous'}.${textbookId}.${catalogVersion}`;
}
function notify(storeKey: string) { listeners.get(storeKey)?.forEach(listener => listener()); }
function readCache(storeKey: string): StoredProgress | null {
  const memory = store.get(storeKey);
  if (memory) return memory;
  try {
    const parsed = JSON.parse(localStorage.getItem(storeKey) || 'null') as StoredProgress | null;
    if (parsed) store.set(storeKey, parsed);
    return parsed;
  } catch { return null; }
}
function writeCache(storeKey: string, value: StoredProgress) {
  store.set(storeKey, value);
  try { localStorage.setItem(storeKey, JSON.stringify(value)); } catch { /* storage is optional */ }
  notify(storeKey);
}

export function applyProgressDelta(scope: string, textbookId: string, delta?: LearningProgressResponse | null): void {
  if (!delta) return;
  const storeKey = key(scope, textbookId, delta.catalog_version);
  const current = readCache(storeKey);
  if (current && delta.revision <= current.revision) return;
  writeCache(storeKey, delta);
}

export function useLearningProgress(token: string | undefined, textbookId: string, catalogVersion: string, scope = 'anonymous') {
  const storeKey = key(scope, textbookId, catalogVersion);
  const [snapshot, setSnapshot] = useState<StoredProgress | null>(() => readCache(storeKey));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSnapshot(readCache(storeKey));
    const set = listeners.get(storeKey) || new Set<() => void>();
    const listener = () => setSnapshot(readCache(storeKey));
    set.add(listener); listeners.set(storeKey, set);
    return () => { set.delete(listener); if (!set.size) listeners.delete(storeKey); };
  }, [storeKey]);

  const refresh = useCallback(async () => {
    if (!token || !textbookId || !catalogVersion) return;
    setLoading(true); setError(null);
    try {
      const next = await getLearningProgress(textbookId, token);
      if (next.catalog_version !== catalogVersion) {
        setError('学习目录版本不一致，请刷新页面');
        return;
      }
      const current = readCache(storeKey);
      if (!current || next.revision > current.revision) writeCache(storeKey, next);
      else setSnapshot(current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '进度加载失败'); }
    finally { setLoading(false); }
  }, [storeKey, textbookId, token]);

  useEffect(() => { void refresh(); }, [refresh]);
  const nodes: ProgressMap = snapshot?.nodes || {};
  return { snapshot, nodes, revision: snapshot?.revision || 0, loading, error, refresh };
}
