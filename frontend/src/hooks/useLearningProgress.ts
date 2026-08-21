import { useCallback, useEffect, useState } from 'react';
import { getLearningProgress, type LearningProgressResponse } from '../services/api';
import type { ProgressMap } from '../catalog/catalogData';
import { loadJSON, saveJSON } from '../utils/storage';
import { progressStorageKey } from '../utils/storageKeys';

type StoredProgress = LearningProgressResponse;
const store = new Map<string, StoredProgress>();
const listeners = new Map<string, Set<() => void>>();

function notify(storeKey: string) { listeners.get(storeKey)?.forEach(listener => listener()); }
function readCache(storeKey: string): StoredProgress | null {
  const memory = store.get(storeKey);
  if (memory) return memory;
  const parsed = loadJSON<StoredProgress | null>(storeKey, null);
  if (parsed) store.set(storeKey, parsed);
  return parsed;
}
function writeCache(storeKey: string, value: StoredProgress) {
  store.set(storeKey, value);
  saveJSON(storeKey, value);
  notify(storeKey);
}

export function applyProgressDelta(scope: string, textbookId: string, delta?: LearningProgressResponse | null): void {
  if (!delta) return;
  const storeKey = progressStorageKey(scope, textbookId, delta.catalog_version);
  const current = readCache(storeKey);
  if (current && delta.revision <= current.revision) return;
  writeCache(storeKey, delta);
}

export function useLearningProgress(
  token: string | undefined,
  textbookId: string,
  catalogVersion: string,
  scope = 'anonymous',
  authReady = true,
) {
  const storeKey = progressStorageKey(scope, textbookId, catalogVersion);
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
    // The initial token may be stale while useAuth validates it. Waiting for
    // authReady prevents that transient 401 from becoming a map warning.
    if (!authReady || !token || !textbookId || !catalogVersion) return;
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
  }, [authReady, storeKey, textbookId, token]);

  useEffect(() => {
    if (!authReady) {
      setError(null);
      setLoading(false);
    }
  }, [authReady]);

  useEffect(() => { void refresh(); }, [refresh]);
  const nodes: ProgressMap = snapshot?.nodes || {};
  return { snapshot, nodes, revision: snapshot?.revision || 0, loading, error, refresh };
}
