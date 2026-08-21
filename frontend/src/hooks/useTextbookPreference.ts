import { useState, useEffect, useMemo } from 'react';
import { TEXTBOOKS } from '../textbooks';
import type { TextbookId } from '../textbooks';
import { loadString, saveString } from '../utils/storage';
import { STORAGE_KEYS } from '../utils/storageKeys';

export const PRESET_PDFS = TEXTBOOKS.map(({ id, name, path }) => ({ name, path, textbookId: id }));
function resolveInitialTextbook(): TextbookId | '' {
  const fromUrl = new URLSearchParams(window.location.search).get('textbook') as TextbookId | null;
  if (fromUrl && TEXTBOOKS.some(item => item.id === fromUrl)) return fromUrl;
  const saved = loadString(STORAGE_KEYS.currentTextbook, null) as TextbookId | null;
  if (saved && TEXTBOOKS.some(item => item.id === saved)) return saved;
  return TEXTBOOKS[0]?.id || '';
}

export function useTextbookPreference() {
  const [textbookId, setTextbookId] = useState<TextbookId | ''>(resolveInitialTextbook);
  const selectedPdf = useMemo(() => PRESET_PDFS.find(item => item.textbookId === textbookId)?.path || '', [textbookId]);

  useEffect(() => {
    if (!textbookId) return;
    saveString(STORAGE_KEYS.currentTextbook, textbookId);
  }, [textbookId]);

  return { selectedPdf, textbookId, setTextbookId };
}
