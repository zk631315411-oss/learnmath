import type { CatalogIndex, CatalogManifest, TextbookCatalog } from './types';

let manifestPromise: Promise<CatalogManifest> | null = null;
const indexCache = new Map<string, Promise<CatalogIndex>>();
const catalogCache = new Map<string, Promise<TextbookCatalog>>();

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`目录加载失败 (${response.status})`);
  return response.json() as Promise<T>;
}

export function loadCatalogManifest(): Promise<CatalogManifest> {
  if (!manifestPromise) manifestPromise = loadJson<CatalogManifest>('/map-catalog/manifest.json');
  return manifestPromise;
}

export async function getCatalogEntry(textbookId: string) {
  const manifest = await loadCatalogManifest();
  return manifest.catalogs.find(item => item.textbook_id === textbookId) || null;
}

export async function loadCatalogIndex(textbookId: string): Promise<CatalogIndex> {
  const cached = indexCache.get(textbookId);
  if (cached) return cached;
  const promise = loadCatalogManifest().then(async manifest => {
    const embedded = manifest.node_index?.[textbookId];
    const embeddedEntry = manifest.catalogs.find(item => item.textbook_id === textbookId);
    if (embedded && embeddedEntry) return { textbook_id: textbookId, catalog_version: embeddedEntry.catalog_version, node_index: embedded };
    const fallbackEntry = await getCatalogEntry(textbookId);
    if (!fallbackEntry) throw new Error('未知教材');
    return loadJson<CatalogIndex>(fallbackEntry.index_path);
  });
  indexCache.set(textbookId, promise);
  return promise;
}

export async function loadTextbookCatalog(textbookId: string): Promise<TextbookCatalog> {
  const cached = catalogCache.get(textbookId);
  if (cached) return cached;
  const promise = getCatalogEntry(textbookId).then(async entry => {
    if (!entry) throw new Error('未知教材');
    const catalog = await loadJson<TextbookCatalog>(entry.catalog_path);
    if (catalog.textbook_id !== textbookId || catalog.catalog_version !== entry.catalog_version) throw new Error('教材目录版本不一致');
    return catalog;
  });
  catalogCache.set(textbookId, promise);
  return promise;
}

export function clearCatalogCaches(): void {
  manifestPromise = null;
  indexCache.clear();
  catalogCache.clear();
}
