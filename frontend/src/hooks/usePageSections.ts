import { useEffect, useState } from 'react';

import { getPageSections } from '../services/api';

/**
 * 拉取教材的「页码 → 顶级小节号（如 1.2）」映射，供提问记录按页定位小节。
 * 仅需一次拉取并缓存于组件生命周期内；失败时保持空映射，调用方降级为只显示页码。
 */
export function usePageSections(textbookId: string, token?: string) {
  const [sections, setSections] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!textbookId || !token) {
      setSections({});
      return;
    }
    let cancelled = false;
    getPageSections(textbookId, token)
      .then(data => { if (!cancelled) setSections(data.page_sections || {}); })
      .catch(() => { if (!cancelled) setSections({}); });
    return () => { cancelled = true; };
  }, [textbookId, token]);

  return sections;
}
