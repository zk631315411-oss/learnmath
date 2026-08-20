import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Visual archives are intentionally opt-in: they exercise many viewports and full-page
// screenshots, so they should not hold up the fast behavioral regression suite.
const runVisualArchive = process.env.VISUAL_ARCHIVE === '1';

const chapter = {
  chapter: '第1章 线性方程组',
  node_count: 1,
  status_counts: { unexplored: 0, learning: 0, basically_mastered: 0, mastered: 1, needs_review: 0 },
  exploration_progress: { explored: 1, total: 1 },
};

type MapFixture = {
  chapters: Record<string, unknown>[];
  nodesByChapter: Record<string, Record<string, unknown>>;
};

type MockOptions = {
  initialHistory?: Record<string, unknown>[];
  streamDelayMs?: number;
  mapByTextbook?: Record<string, MapFixture>;
  chapterDelayByTextbook?: Record<string, number>;
  progressFailureAttempts?: number;
  progressDelta?: Record<string, unknown>;
  staticPage?: number | null;
};

const R1: Record<string, unknown> = {
  id: 't1', question: '什么是秩？', answer: '秩是矩阵中线性无关行（列）的最大数。', page_number: 1,
  marker_y_ratio: 30, marker_type: 'text', textbook_id: 'gaodai_shang', thumbnail: null, crop_bbox: null,
  follow_ups: [], thinking: null, tool_activities: [], created_at: '2026-08-18 09:00:00',
};
const R2: Record<string, unknown> = {
  id: 't2', question: '线性无关怎么判？', answer: '看齐次线性组合是否只有零解。', page_number: 2,
  marker_y_ratio: 40, marker_type: 'text', textbook_id: 'gaodai_shang', thumbnail: null, crop_bbox: null,
  follow_ups: [], thinking: null, tool_activities: [], created_at: '2026-08-18 09:05:00',
};

function normalizedHistoryRecord(id: string, data: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    question: data.question || '',
    answer: data.answer ?? null,
    page_number: data.page_number ?? 1,
    marker_y_ratio: data.marker_y_ratio ?? 0,
    marker_type: data.marker_type || 'text',
    textbook_id: data.textbook_id ?? 'gaodai_shang',
    thumbnail: data.thumbnail ?? null,
    crop_bbox: data.crop_bbox ?? null,
    follow_ups: data.follow_ups ?? [],
    thinking: data.thinking ?? null,
    tool_activities: data.tool_activities ?? [],
    created_at: data.created_at || '2026-08-18 10:00:00',
  };
}

async function mockApp(page: Page, options: MockOptions = {}) {
  let history: Record<string, unknown>[] = (options.initialHistory || []).map(item => ({ ...item }));
  let nextId = 1;
  const streamDelayMs = options.streamDelayMs ?? 350;
  const defaultMap: MapFixture = {
    chapters: [chapter],
    nodesByChapter: {
      [chapter.chapter]: { textbook_id: 'gaodai_shang', chapter: chapter.chapter, sections: [{ section: '1.1', nodes: [{ node_id: 'n1', name: '线性方程组', section: '1.1', status: 'mastered', closed_evidence_count: 1, blocked: false, chat: { id: null, available: false } }] }] },
    },
  };
  const mapByTextbook = options.mapByTextbook || { gaodai_shang: defaultMap };
  let progressAttempts = 0;
  const textbookNames: Record<string, string> = {
    gaodai_shang: '高等代数（上册）丘维声',
    gaodai_xia: '高等代数（下册）丘维声',
    gaoshu_shang: '高等数学（上册）',
    gaoshu_xia: '高等数学（下册）',
  };
  const nodeRecords = (textbookId: string, fixture: MapFixture) => Object.values(fixture.nodesByChapter)
    .flatMap((response: any) => (response.sections || []).flatMap((section: any) => (section.nodes || []).map((node: any, order: number) => ({
      node_id: node.node_id,
      name: node.name,
      type: node.type || 'concept',
      chapter: response.chapter,
      section: node.section || section.section,
      section_node_id: null,
      prerequisite_ids: node.prerequisite_ids || [],
      order,
    }))));
  const catalogFor = (textbookId: string, fixture: MapFixture) => {
    const staticPage = options.staticPage === undefined ? 26 : options.staticPage;
    const chapters = fixture.chapters.map((item: any, order: number) => {
      const response: any = fixture.nodesByChapter[item.chapter] || { chapter: item.chapter, sections: [] };
      const sections = (response.sections || []).map((section: any, sectionOrder: number) => ({
        id: `${textbookId}:section:${order + 1}.${sectionOrder + 1}`,
        name: section.section,
        page: staticPage,
        nodes: (section.nodes || []).map((node: any, nodeOrder: number) => ({
          node_id: node.node_id,
          name: node.name,
          type: node.type || 'concept',
          chapter: item.chapter,
          section: node.section || section.section,
          section_node_id: null,
          prerequisite_ids: node.prerequisite_ids || [],
          order: nodeOrder,
        })),
      }));
      return {
        id: `${textbookId}:chapter:${order + 1}`,
        name: item.chapter,
        number: order + 1,
        order,
        node_count: item.node_count || sections.reduce((sum: number, section: any) => sum + section.nodes.length, 0),
        first_page: staticPage,
        sections,
      };
    });
    return { textbook_id: textbookId, display_name: textbookNames[textbookId] || textbookId, catalog_version: `${textbookId}-e2e`, chapters };
  };
  const fixtureFor = (textbookId: string) => mapByTextbook[textbookId] || { chapters: [], nodesByChapter: {} };
  const manifestFor = () => {
    const ids = [...new Set(['gaodai_shang', 'gaodai_xia', ...Object.keys(mapByTextbook)])];
    const catalogs = ids.map(id => {
      const catalog: any = catalogFor(id, fixtureFor(id));
      return {
        textbook_id: id,
        display_name: catalog.display_name,
        catalog_version: catalog.catalog_version,
        index_path: `/map-catalog/${id}.index.json`,
        catalog_path: `/map-catalog/${id}.json`,
        chapters: catalog.chapters.map((item: any) => ({ id: item.id, name: item.name, number: item.number, order: item.order, node_count: item.node_count, first_page: item.first_page })),
      };
    });
    const node_index: Record<string, unknown[]> = {};
    ids.forEach(id => { node_index[id] = nodeRecords(id, fixtureFor(id)); });
    return { schema_version: 1, catalogs, node_index };
  };
  await page.route('**/api/auth/anonymous?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ access_token: 'e2e-token', token_type: 'bearer', user_id: 'e2e-user', username: 'anonymous', is_anonymous: true }),
  }));
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: 'e2e-user', username: 'anonymous', is_anonymous: true }),
  }));
  await page.route('**/map-catalog/manifest.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifestFor()) }));
  await page.route('**/map-catalog/*.index.json', async route => {
    const textbookId = route.request().url().match(/map-catalog\/([^/]+)\.index\.json/)?.[1] || 'gaodai_shang';
    const catalog: any = catalogFor(textbookId, fixtureFor(textbookId));
    const node_index = nodeRecords(textbookId, fixtureFor(textbookId));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ textbook_id: textbookId, catalog_version: catalog.catalog_version, node_index }) });
  });
  await page.route('**/map-catalog/*.json', async route => {
    if (route.request().url().endsWith('/map-catalog/manifest.json')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifestFor()) });
    }
    const textbookId = route.request().url().match(/map-catalog\/([^/]+)\.json/)?.[1] || 'gaodai_shang';
    if (route.request().url().includes('.index.json')) {
      const catalog: any = catalogFor(textbookId, fixtureFor(textbookId));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ textbook_id: textbookId, catalog_version: catalog.catalog_version, node_index: nodeRecords(textbookId, fixtureFor(textbookId)) }) });
    }
    const delay = options.chapterDelayByTextbook?.[textbookId] || 0;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const catalog = catalogFor(textbookId, fixtureFor(textbookId));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalog) });
  });
  await page.route('**/api/learning-progress?*', async route => {
    progressAttempts += 1;
    if (progressAttempts <= (options.progressFailureAttempts || 0)) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'mock progress failure' }) });
    const textbookId = new URL(route.request().url()).searchParams.get('textbook_id') || 'gaodai_shang';
    const nodes: Record<string, unknown> = {};
    nodeRecords(textbookId, fixtureFor(textbookId)).forEach((node: any) => {
      const source = (fixtureFor(textbookId).nodesByChapter[node.chapter] as any)?.sections?.flatMap((section: any) => section.nodes || []).find((item: any) => item.node_id === node.node_id);
      if (source?.status && source.status !== 'unexplored') nodes[node.node_id] = { status: source.status, closed_evidence_count: source.closed_evidence_count || 0, last_activity_at: null, source_chat_id: source.chat?.id || null };
    });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ textbook_id: textbookId, catalog_version: `${textbookId}-e2e`, revision: 1, nodes }) });
  });
  await page.route('**/api/textbook/section-page?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ page: 26, confidence: 1, matched_text: '1.1' }) }));
  await page.route('**/api/chat/history**', async route => {
    const method = route.request().method();
    // Batch 1：追问 turn 级端点 /api/chat/history/{id}/follow-ups[/{turnId}]
    const followUpMatch = new URL(route.request().url()).pathname.match(/\/api\/chat\/history\/([^/]+)\/follow-ups(?:\/([^/]+))?$/);
    if (followUpMatch) {
      const chatId = followUpMatch[1];
      const turnId = followUpMatch[2] ? decodeURIComponent(followUpMatch[2]) : null;
      if (method === 'POST') {
        const data = await route.request().postDataJSON();
        history = history.map(item => {
          if (item.id !== chatId) return item;
          const followUps = Array.isArray(item.follow_ups) ? item.follow_ups : [];
          if (followUps.some((fu: any) => fu.turn_id === data.turn_id)) return item;
          return { ...item, follow_ups: [...followUps, data] };
        });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
      }
      if (method === 'PATCH' && turnId) {
        const data = await route.request().postDataJSON();
        history = history.map(item => item.id !== chatId ? item : {
          ...item,
          follow_ups: (Array.isArray(item.follow_ups) ? item.follow_ups : []).map((fu: any) => fu.turn_id === turnId ? { ...fu, ...data } : fu),
        });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'not found' }) });
    }
    if (method === 'GET') {
      const textbookId = new URL(route.request().url()).searchParams.get('textbook_id');
      const visible = textbookId ? history.filter(item => item.textbook_id === textbookId) : history;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(visible) });
    }
    if (method === 'POST') {
      const data = await route.request().postDataJSON();
      const id = `mock-thread-${nextId++}`;
      history = [...history, normalizedHistoryRecord(id, data)];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id }) });
    }
    if (method === 'PATCH') {
      const data = await route.request().postDataJSON();
      const id = new URL(route.request().url()).pathname.split('/').pop();
      history = history.map(item => item.id === id ? { ...item, ...data, follow_ups: typeof data.follow_ups === 'string' ? JSON.parse(data.follow_ups) : data.follow_ups ?? item.follow_ups } : item);
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 204 });
  });
  await page.route('**/api/qa/solve-stream', async route => {
    await new Promise(resolve => setTimeout(resolve, streamDelayMs));
    const body = [
      'event: content',
      `data: ${JSON.stringify({ text: '先观察系数矩阵的秩。' })}`,
      '',
      'event: stage',
      `data: ${JSON.stringify({ stage: 'evidence_report', text: '正在记录学习进度…' })}`,
      '',
      'event: done',
      `data: ${JSON.stringify({ full_text: '先观察系数矩阵的秩。', sources: [], tool_activities: [], qa_turn_id: 'mock-qa-turn-1', progress_delta: options.progressDelta || null })}`,
      '',
      '',
    ].join('\n');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
}

async function enterReader(page: Page) {
  await page.goto('/');
  await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /^(直接开始阅读|打开教材|继续学习)$/ }).first().click();
  await expect(page.getByRole('button', { name: '框选提问' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '下一页' }).first()).toBeEnabled();
}

async function openQuestionFromHistory(page: Page, question: string) {
  const desktopDrawer = page.getByTitle('打开提问记录');
  if (await desktopDrawer.count()) {
    await desktopDrawer.click();
  } else {
    const utilityButton = page.getByRole('button', { name: '提问记录与学习地图' });
    if (await utilityButton.count() && await utilityButton.first().isVisible()) {
      await utilityButton.first().click();
    } else {
      const chatButton = page.getByRole('button', { name: /AI 旁批/ });
      if (await chatButton.count() && await chatButton.first().isVisible()) await chatButton.first().click();
    }
  }
  await page.getByRole('button', { name: new RegExp(question) }).click();
}

test('first visit opens map and later restores the reader workspace', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await enterReader(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('learnmath.workspace.gaodai_shang'))).not.toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: '框选提问' }).first()).toBeVisible();
  await expect(page.getByText('学习地图', { exact: true }).first()).not.toBeVisible();
});

test('utility drawer opens and closes without taking layout width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await enterReader(page);
  await page.getByTitle('打开提问记录').click();
  await expect(page.getByRole('dialog', { name: '学习工具' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '学习工具' })).toBeHidden();
});

test('mobile handle moves through collapsed, half and full stages', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile');
  await mockApp(page);
  await enterReader(page);
  const handle = page.getByTestId('bottom-sheet-handle');
  await handle.dispatchEvent('pointerdown', { pointerId: 1, clientY: 780 });
  await handle.dispatchEvent('pointerup', { pointerId: 1, clientY: 710 });
  await expect(page.getByText('本页旁批', { exact: true })).toBeVisible();
  await handle.dispatchEvent('pointerdown', { pointerId: 2, clientY: 780 });
  await handle.dispatchEvent('pointerup', { pointerId: 2, clientY: 710 });
  await expect(page.getByText('学习工具', { exact: true })).toBeVisible();
  await handle.dispatchEvent('pointerdown', { pointerId: 3, clientY: 710 });
  await handle.dispatchEvent('pointerup', { pointerId: 3, clientY: 780 });
  await expect(page.getByText('本页旁批', { exact: true })).toBeVisible();
});

test('capture bubble enforces draft, streaming and completed states', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await enterReader(page);
  await page.getByRole('button', { name: '框选提问' }).first().click();
  await page.getByRole('menuitem', { name: '框选提问' }).evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.getByText('拖动鼠标框选区域，按 ESC 取消')).toBeVisible();
  const viewer = page.getByTestId('pdf-scroll-container');
  const box = await viewer.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 120, box!.y + 120);
  await page.mouse.down();
  await page.mouse.move(box!.x + 360, box!.y + 260, { steps: 8 });
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.getByTitle('确认截图').click();
  const bubble = page.getByTestId('capture-bubble');
  await expect(bubble).toHaveAttribute('data-state', 'draft');
  await bubble.getByPlaceholder('想问什么？').fill('这一步为什么成立？');
  await bubble.getByRole('button', { name: '发送' }).click();
  await expect(bubble).toHaveAttribute('data-state', 'streaming');
  await expect(bubble.getByRole('button', { name: '关闭框选提问' })).toBeEnabled();
  await expect(bubble).toHaveAttribute('data-state', 'complete');
  await expect(bubble.getByText('先观察系数矩阵的秩。')).toBeVisible();
  await bubble.getByRole('button', { name: '关闭框选提问' }).click();
  await expect(bubble).toBeHidden();
  await expect(page.getByText('第 1 页 · 1 条记录')).toBeVisible();
});

test('evidence stage remains visible below streamed answer until done', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await enterReader(page);
  await page.evaluate(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes('/api/qa/solve-stream')) return nativeFetch(input, init);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => controller.enqueue(encoder.encode(
            `event: content\ndata: ${JSON.stringify({ text: '这是已经生成的回答。' })}\n\n`,
          )), 20);
          setTimeout(() => controller.enqueue(encoder.encode(
            `event: stage\ndata: ${JSON.stringify({ stage: 'evidence_report', text: '正在记录学习进度…' })}\n\n`,
          )), 100);
          setTimeout(() => {
            controller.enqueue(encoder.encode(
              `event: done\ndata: ${JSON.stringify({ full_text: '这是已经生成的回答。', sources: [], tool_activities: [] })}\n\n`,
            ));
            controller.close();
          }, 700);
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
  });

  await page.getByRole('button', { name: '这页哪里没看懂？' }).click();
  await expect(page.getByText('这是已经生成的回答。')).toBeVisible();
  await expect(page.getByTestId('evidence-report-status')).toBeVisible();
  await expect(page.getByTestId('evidence-report-status')).toBeHidden();
});

test('visual regression archive covers the approved viewports and surfaces', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  test.skip(!runVisualArchive, 'visual archive is opt-in; set VISUAL_ARCHIVE=1');
  test.setTimeout(90_000);
  const visualChapter = {
    ...chapter,
    node_count: 2,
    status_counts: { unexplored: 0, learning: 1, basically_mastered: 0, mastered: 0, needs_review: 1 },
    exploration_progress: { explored: 2, total: 2 },
  };
  await mockApp(page, {
    initialHistory: [R1, R2],
    mapByTextbook: {
      gaodai_shang: {
        chapters: [visualChapter],
        nodesByChapter: {
          [visualChapter.chapter]: { textbook_id: 'gaodai_shang', chapter: visualChapter.chapter, sections: [{ section: '1.1', nodes: [
            { node_id: 'n1', name: '线性方程组', section: '1.1', status: 'learning', closed_evidence_count: 1, blocked: false, chat: { id: 't1', available: true } },
            { node_id: 'n2', name: '矩阵的秩', section: '1.1', status: 'needs_review', closed_evidence_count: 1, blocked: false, chat: { id: 't2', available: true } },
          ] }] },
        },
      },
    },
  });
  await page.addInitScript(() => localStorage.clear());
  const artifactDir = resolve(process.cwd(), '..', 'artifacts', 'visual-20260818');
  await mkdir(artifactDir, { recursive: true });

  const capture = async (scene: string, width: number, dark: boolean) => {
    await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(() => page.evaluate(expectedDark => {
      const card = document.querySelector('main button.group');
      return document.documentElement.classList.contains('dark') === expectedDark
        && (!card || getComputedStyle(card).backgroundColor === (expectedDark ? 'rgb(15, 23, 42)' : 'rgb(255, 255, 255)'));
    }, dark)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: resolve(artifactDir, `${scene}-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
  };

  const mapCases = [
    { width: 1440, height: 900, themes: [false, true] },
    { width: 1280, height: 800, themes: [false] },
    { width: 768, height: 900, themes: [false, true] },
    { width: 390, height: 844, themes: [false, true] },
    { width: 812, height: 375, themes: [false] },
  ];
  for (const viewport of mapCases) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
    for (const dark of viewport.themes) await capture('map', viewport.width, dark);
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.getByRole('button', { name: '选择教材' }).click();
    await expect(page.getByRole('listbox', { name: '教材列表' })).toBeVisible();
    await capture('map-textbook-menu', viewport.width, false);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /第 1 章.*查看地图/ }).click();
    await expect(page.getByRole('button', { name: '开始本章' })).toBeVisible();
    await page.getByRole('button', { name: /1\.1/ }).click();
    for (const dark of viewport.themes) await capture('chapter-detail', viewport.width, dark);
    await page.getByRole('button', { name: '返回章节' }).click();
  }

  const readerCases = [
    { width: 1440, height: 900, themes: [false, true] },
    { width: 1280, height: 800, themes: [false] },
    { width: 812, height: 375, themes: [false] },
  ];
  for (const viewport of readerCases) {
    await page.setViewportSize(viewport);
    await enterReader(page);
    await expect(page.getByRole('button', { name: '下一页' })).toBeEnabled();
    if (viewport.width >= 1024) {
      await page.getByTitle('打开提问记录').click();
      await expect(page.getByRole('dialog', { name: '学习工具' })).toBeVisible();
    } else {
      await page.getByRole('button', { name: '提问记录与学习地图' }).click();
      await expect(page.getByText('学习工具', { exact: true })).toBeVisible();
    }
    for (const dark of viewport.themes) await capture('reader-drawer', viewport.width, dark);
  }

  const sheetCases = [
    { width: 768, height: 900, themes: [false] },
    { width: 390, height: 844, themes: [false, true] },
    { width: 812, height: 375, themes: [false] },
  ];
  for (const viewport of sheetCases) {
    await page.setViewportSize(viewport);
    await enterReader(page);
    await expect(page.getByRole('button', { name: '下一页' })).toBeEnabled();
    await page.getByRole('button', { name: /AI 旁批/ }).click();
    await expect(page.getByText('本页旁批', { exact: true })).toBeVisible();
    for (const dark of viewport.themes) await capture('reader-sheet-half', viewport.width, dark);
  }

});

test('visual capture bubble archive', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  test.skip(!runVisualArchive, 'visual archive is opt-in; set VISUAL_ARCHIVE=1');
  await mockApp(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterReader(page);
  const bubble = await createCaptureBubble(page, true);
  await bubble.getByPlaceholder('想问什么？').fill('这一步为什么成立？');
  await bubble.getByRole('button', { name: '发送' }).click();
  await expect(bubble).toHaveAttribute('data-state', 'complete');
  const artifactDir = resolve(process.cwd(), '..', 'artifacts', 'visual-20260818');
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: resolve(artifactDir, 'capture-bubble-1440-light.png'), fullPage: true });
});

test('E1 conversation view survives page changes and jumps back to its source page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, { initialHistory: [R1, R2] });
  await enterReader(page);
  await openQuestionFromHistory(page, '什么是秩？');
  await expect(page.getByText('对话视图', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('2');
  await expect(page.getByText('秩是矩阵中线性无关行（列）的最大数。')).toBeVisible();
  await page.getByRole('button', { name: /来自第 1 页/ }).click();
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('1');
});

test('E2 page questions create a new thread while thread questions patch follow-ups', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, { initialHistory: [R1, R2] });
  const threadPosts: Record<string, unknown>[] = [];
  const followUpPosts: Record<string, unknown>[] = [];
  const followUpPatches: Record<string, unknown>[] = [];
  page.on('request', request => {
    if (request.method() !== 'POST' && request.method() !== 'PATCH') return;
    if (!request.url().includes('/api/chat/history')) return;
    const data = request.postDataJSON?.();
    if (request.url().includes('/follow-ups/') && request.method() === 'PATCH') followUpPatches.push(data);
    else if (request.url().includes('/follow-ups') && request.method() === 'POST') followUpPosts.push(data);
    else if (request.method() === 'POST') threadPosts.push(data);
  });
  await enterReader(page);
  await openQuestionFromHistory(page, '什么是秩？');
  await page.getByRole('button', { name: '返回本页' }).click();
  await page.getByRole('textbox', { name: '输入问题…' }).fill('新问题');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('先观察系数矩阵的秩。')).toBeVisible();
  await expect.poll(() => threadPosts.length).toBeGreaterThan(0);
  expect(threadPosts.at(-1)?.page_number).toBe(1);
  // Batch 1：新线程创建携带稳定 client_turn_id
  expect(typeof threadPosts.at(-1)?.client_turn_id).toBe('string');
  await page.getByRole('textbox', { name: '输入问题…' }).fill('追问一句');
  await page.getByRole('button', { name: '发送' }).click();
  // Batch 1 新契约：追问先 POST pending 项（带 turn_id），收尾按 turn_id PATCH completed
  await expect.poll(() => followUpPosts.some(item => item.status === 'pending' && typeof item.turn_id === 'string')).toBe(true);
  await expect.poll(() => followUpPatches.some(item => item.status === 'completed' && typeof item.answer === 'string')).toBe(true);
});

test('E3 page notes stay scoped to the current page and empty pages show starters', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, { initialHistory: [R1, R2] });
  await enterReader(page);
  await expect(page.getByText('第 1 页 · 1 条记录')).toBeVisible();
  await expect(page.getByText('线性无关怎么判？')).not.toBeVisible();
  await page.getByRole('button', { name: '下一页' }).click();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('第 3 页 · 0 条记录')).toBeVisible();
  await expect(page.getByText('第 3 页还没有提问')).toBeVisible();
  await page.getByRole('button', { name: '上一页' }).click();
  await expect(page.getByText('第 2 页 · 1 条记录')).toBeVisible();
  await expect(page.getByText('线性无关怎么判？')).toBeVisible();
});

test('E4 opening the drawer and starting capture keeps overlay surfaces mutually exclusive', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await enterReader(page);
  await page.getByTitle('打开提问记录').click();
  await expect(page.getByRole('dialog', { name: '学习工具' })).toBeVisible();
  // The drawer backdrop owns pointer events while open; invoke the toolbar
  // action directly to verify the top-level overlay state transition.
  await page.getByRole('button', { name: '框选提问' }).first().evaluate((element) => (element as HTMLButtonElement).click());
  await page.getByRole('menuitem', { name: '框选提问' }).evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.getByRole('dialog', { name: '学习工具' })).toBeHidden();
  await expect(page.getByText('拖动鼠标框选区域，按 ESC 取消')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('拖动鼠标框选区域，按 ESC 取消')).toBeHidden();
});

async function createCaptureBubble(page: Page, nearRightEdge = false) {
  await page.getByRole('button', { name: '框选提问' }).first().click();
  await page.getByRole('menuitem', { name: '框选提问' }).click();
  await expect(page.getByText('拖动鼠标框选区域，按 ESC 取消')).toBeVisible();
  const viewer = page.getByTestId('pdf-scroll-container');
  const box = await viewer.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + (nearRightEdge ? Math.max(120, box!.width - 400) : 120);
  const endX = box!.x + (nearRightEdge ? Math.max(240, box!.width - 280) : 360);
  await page.mouse.move(startX, box!.y + 120);
  await page.mouse.down();
  await page.mouse.move(endX, box!.y + 260, { steps: 8 });
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.getByTitle('确认截图').click();
  return page.getByTestId('capture-bubble');
}

test('mobile capture bubble is a bottom card and completes a mocked answer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile');
  await mockApp(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await enterReader(page);
  await page.getByRole('button', { name: '框选提问' }).click();
  await page.getByRole('menuitem', { name: '框选提问' }).click();
  await expect(page.getByText('裁剪截图', { exact: true })).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: '确认截取' }).click();
  const bubble = page.getByTestId('capture-bubble');
  await expect(bubble).toHaveAttribute('data-state', 'draft');
  const bubbleBox = await bubble.boundingBox();
  expect(bubbleBox).not.toBeNull();
  expect(Math.abs(bubbleBox!.y + bubbleBox!.height - 844)).toBeLessThan(3);
  await bubble.getByPlaceholder('想问什么？').fill('移动端这一步为什么成立？');
  await bubble.getByRole('button', { name: '发送' }).click();
  await expect(bubble).toHaveAttribute('data-state', 'complete');
});

test('E5 capture bubble supports a follow-up and expansion into the right panel', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await enterReader(page);
  const bubble = await createCaptureBubble(page);
  await bubble.getByPlaceholder('想问什么？').fill('这一步为什么成立？');
  await bubble.getByRole('button', { name: '发送' }).click();
  await expect(bubble).toHaveAttribute('data-state', 'complete');
  await bubble.getByPlaceholder('继续追问…').fill('能再给一个例子吗？');
  await bubble.getByRole('button', { name: '发送' }).click();
  await expect(bubble).toHaveAttribute('data-state', 'complete');
  await bubble.getByRole('button', { name: '在右栏展开' }).click();
  await expect(page.getByText('对话视图', { exact: true })).toBeVisible();
  await expect(page.getByAltText('用户截图')).toBeVisible();
});

test('E6 switching between map and reader preserves the active conversation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, { initialHistory: [R1, R2] });
  await enterReader(page);
  await openQuestionFromHistory(page, '什么是秩？');
  await expect(page.getByText('秩是矩阵中线性无关行（列）的最大数。')).toBeVisible();
  await page.locator('header').getByRole('button', { name: '地图' }).click();
  await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
  await page.locator('header').getByTitle('开始阅读').click();
  await expect(page.getByText('对话视图', { exact: true })).toBeVisible();
  await expect(page.getByText('秩是矩阵中线性无关行（列）的最大数。')).toBeVisible();
});

test('E7 chapter card opens the chapter map and its primary action enters the reader', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await page.goto('/');
  await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
  await page.locator('main button').filter({ hasText: '线性方程组' }).last().click();
  await expect(page.getByRole('button', { name: '开始本章' })).toBeVisible();
  await page.getByText('显示全部', { exact: true }).click();
  await expect(page.getByText('1.1', { exact: true })).toBeVisible();
  const sectionRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/textbook/section-page')) sectionRequests.push(request.url()); });
  await page.getByRole('button', { name: '开始本章' }).click();
  await expect(page.getByRole('button', { name: '框选提问' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('26');
  expect(sectionRequests).toHaveLength(0);
});

test('E7 chapter map falls back without a blank reader on a scan miss', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, { staticPage: null });
  await page.goto('/');
  await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
  await page.locator('main button').filter({ hasText: '线性方程组' }).last().click();
  await page.getByRole('button', { name: '开始本章' }).click();
  await expect(page.getByRole('button', { name: '框选提问' })).toBeVisible();
});

test('M1 map textbook selector switches the map data', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, {
    mapByTextbook: {
      gaodai_shang: {
        chapters: [chapter],
        nodesByChapter: {},
      },
      gaodai_xia: {
        chapters: [{ ...chapter, chapter: '第1章 多项式', node_count: 2, exploration_progress: { explored: 0, total: 2 } }],
        nodesByChapter: {},
      },
    },
  });
  const legacyRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/learning-map/')) legacyRequests.push(request.url());
  });
  await page.goto('/');
  const selector = page.getByRole('button', { name: '选择教材' });
  await expect(selector).toContainText('高等代数（上册）丘维声');
  await selector.click();
  await page.getByRole('option', { name: '高等代数（下册）丘维声' }).click();
  await expect(selector).toContainText('高等代数（下册）丘维声');
  await expect(page.getByText('多项式', { exact: true })).toBeVisible();
  expect(legacyRequests).toHaveLength(0);
});

test('M1 late response from the previous textbook cannot overwrite the active map', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, {
    chapterDelayByTextbook: { gaodai_shang: 700 },
    mapByTextbook: {
      gaodai_shang: { chapters: [chapter], nodesByChapter: {} },
      gaodai_xia: { chapters: [{ ...chapter, chapter: '第1章 下册专属章节' }], nodesByChapter: {} },
    },
  });
  await page.goto('/');
  const selector = page.getByRole('button', { name: '选择教材' });
  await selector.click();
  await page.getByRole('option', { name: '高等代数（下册）丘维声' }).click();
  await expect(page.getByText('下册专属章节', { exact: true })).toBeVisible();
  await page.waitForTimeout(900);
  await expect(page.getByText('下册专属章节', { exact: true })).toBeVisible();
  await expect(page.getByText('线性方程组', { exact: true })).toHaveCount(0);
});

test('M2 textbook selection persists across reload', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, {
    mapByTextbook: {
      gaodai_shang: { chapters: [chapter], nodesByChapter: {} },
      gaodai_xia: { chapters: [{ ...chapter, chapter: '第1章 多项式' }], nodesByChapter: {} },
    },
  });
  await page.goto('/');
  await page.getByRole('button', { name: '选择教材' }).click();
  await page.getByRole('option', { name: '高等代数（下册）丘维声' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '选择教材' })).toContainText('高等代数（下册）丘维声');
  await expect(page.getByText('多项式', { exact: true })).toBeVisible();
});

test('M2 map cache is isolated when the authenticated user changes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, { mapByTextbook: { gaodai_shang: { chapters: [chapter], nodesByChapter: {} } } });
  await page.goto('/');
  await expect(page.getByText('线性方程组', { exact: true })).toBeVisible();
  const legacyRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/learning-map/')) legacyRequests.push(request.url()); });

  await page.unroute('**/api/auth/anonymous?*');
  await page.route('**/api/auth/anonymous?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'e2e-token-b', token_type: 'bearer', user_id: 'e2e-user-b', username: 'anonymous-b', is_anonymous: true }) }));
  await page.evaluate(() => localStorage.removeItem('auth_token'));
  await page.reload();
  await expect(page.getByText('线性方程组', { exact: true })).toBeVisible();
  expect(legacyRequests).toHaveLength(0);
});

test('M2 reader workspace view and page stay isolated per textbook', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  const secondChapter = { ...chapter, chapter: '第1章 多项式' };
  await mockApp(page, {
    mapByTextbook: {
      gaodai_shang: { chapters: [chapter], nodesByChapter: {} },
      gaodai_xia: { chapters: [secondChapter], nodesByChapter: {} },
    },
  });
  await enterReader(page);
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('2');
  await page.locator('header select').selectOption('gaodai_xia');
  await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const workspace = JSON.parse(localStorage.getItem('learnmath.workspace.gaodai_xia') || '{}');
    return { view: workspace.view, page: workspace.page };
  })).toEqual({ view: 'map', page: 1 });
  await page.getByRole('button', { name: '选择教材' }).click();
  await page.getByRole('option', { name: '高等代数（上册）丘维声' }).click();
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('2');
});

test('M3 static chapter index renders without legacy node requests', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  const legacyRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/learning-map/')) legacyRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByText('线性方程组', { exact: true })).toBeVisible();
  await page.locator('main button').filter({ hasText: '线性方程组' }).last().click();
  await expect(page.getByRole('button', { name: '开始本章' })).toBeVisible();
  expect(legacyRequests).toHaveLength(0);
});

test('M4 chapter cards expose learning status summaries', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  const statusChapter = {
    ...chapter,
    node_count: 2,
    status_counts: { unexplored: 0, learning: 1, basically_mastered: 0, mastered: 0, needs_review: 1 },
    exploration_progress: { explored: 2, total: 2 },
  };
  await mockApp(page, {
    mapByTextbook: {
      gaodai_shang: {
        chapters: [statusChapter],
        nodesByChapter: {
          [statusChapter.chapter]: { textbook_id: 'gaodai_shang', chapter: statusChapter.chapter, sections: [{ section: '1.1', nodes: [
            { node_id: 'n1', name: '线性方程组', section: '1.1', status: 'learning', closed_evidence_count: 1, blocked: false, chat: { id: null, available: false } },
            { node_id: 'n2', name: '矩阵秩', section: '1.1', status: 'needs_review', closed_evidence_count: 1, blocked: false, chat: { id: null, available: false } },
          ] }] },
        },
      },
    },
  });
  await page.goto('/');
  await expect(page.getByText('1 个需巩固', { exact: true })).toBeVisible();
  await expect(page.getByText('2 / 2 已探索', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /矩阵秩/ })).toBeVisible();
});

test('M6 knowledge section takes priority over an unrelated source question page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  const sourceChapter = { ...chapter, status_counts: { unexplored: 0, learning: 1, basically_mastered: 0, mastered: 0, needs_review: 0 }, exploration_progress: { explored: 1, total: 1 } };
  await mockApp(page, {
    initialHistory: [R1],
    mapByTextbook: {
      gaodai_shang: {
        chapters: [sourceChapter],
        nodesByChapter: {
          [sourceChapter.chapter]: { textbook_id: 'gaodai_shang', chapter: sourceChapter.chapter, sections: [{ section: '1.2', nodes: [{ node_id: 'n1', name: '线性方程组', section: '1.2', status: 'learning', closed_evidence_count: 1, blocked: false, chat: { id: 't1', available: true } }] }] },
        },
      },
    },
  });
  await page.goto('/');
  await page.locator('main button').filter({ hasText: '线性方程组' }).last().click();
  await page.getByRole('button', { name: /1\.2/ }).click();
  await page.getByRole('button', { name: '继续' }).click();
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('26');
});

test('M6 falls back from node section to the chapter first section', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  const fallbackChapter = { ...chapter, status_counts: { unexplored: 1, learning: 1, basically_mastered: 0, mastered: 0, needs_review: 0 }, exploration_progress: { explored: 1, total: 2 } };
  await mockApp(page, {
    mapByTextbook: {
      gaodai_shang: {
        chapters: [fallbackChapter],
        nodesByChapter: {
          [fallbackChapter.chapter]: { textbook_id: 'gaodai_shang', chapter: fallbackChapter.chapter, sections: [
            { section: '1.1', nodes: [{ node_id: 'n0', name: '预备知识', section: '1.1', status: 'unexplored', closed_evidence_count: 0, blocked: false, chat: { id: null, available: false } }] },
            { section: '1.2', nodes: [{ node_id: 'n1', name: '线性方程组', section: '1.2', status: 'learning', closed_evidence_count: 1, blocked: false, chat: { id: null, available: false } }] },
          ] },
        },
      },
    },
  });
  const sectionsRequested: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/textbook/section-page')) sectionsRequested.push(request.url()); });
  await page.goto('/');
  await page.locator('main button').filter({ hasText: '线性方程组' }).last().click();
  await page.getByRole('button', { name: /1\.2/ }).click();
  await page.getByRole('button', { name: '继续' }).click();
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('26');
  expect(sectionsRequested).toHaveLength(0);
});

test('M7 progress errors keep the static map and reading escape hatch', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, { progressFailureAttempts: 1 });
  await page.goto('/');
  await expect(page.getByText('线性方程组', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(直接开始阅读|打开教材|继续学习)$/ })).toBeVisible();
  await page.getByRole('button', { name: '刷新学习地图' }).click();
  await expect(page.getByText('线性方程组', { exact: true })).toBeVisible();
});

test('D1 SSE progress delta updates the map without a full progress refetch', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  const delta = {
    textbook_id: 'gaodai_shang', catalog_version: 'gaodai_shang-e2e', revision: 2,
    nodes: { n1: { status: 'mastered', closed_evidence_count: 2, last_activity_at: null, source_chat_id: null } },
  };
  await mockApp(page, {
    mapByTextbook: {
      gaodai_shang: {
        chapters: [{ ...chapter, status_counts: { unexplored: 0, learning: 1, basically_mastered: 0, mastered: 0, needs_review: 0 } }],
        nodesByChapter: {
          [chapter.chapter]: { textbook_id: 'gaodai_shang', chapter: chapter.chapter, sections: [{ section: '1.1', nodes: [{ node_id: 'n1', name: '线性方程组', section: '1.1', status: 'learning', closed_evidence_count: 1, blocked: false, chat: { id: null, available: false } }] }] },
        },
      },
    },
    progressDelta: delta,
  });
  let progressRequests = 0;
  page.on('request', request => { if (request.url().includes('/api/learning-progress')) progressRequests += 1; });
  await page.goto('/');
  await expect(page.getByText('1 个学习中', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续学习' }).click();
  const bubble = await createCaptureBubble(page);
  await bubble.getByPlaceholder('想问什么？').fill('增量状态测试');
  await bubble.getByRole('button', { name: '发送' }).click();
  await expect(bubble).toHaveAttribute('data-state', 'complete');
  await bubble.getByRole('button', { name: '关闭框选提问' }).click();
  await page.locator('header').getByRole('button', { name: '地图' }).click();
  await expect(page.getByText('全部掌握', { exact: true })).toBeVisible();
  expect(progressRequests).toBe(1);
});

test('F8 auth failure still leaves a map and reader escape hatch', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await page.unroute('**/api/auth/anonymous?*');
  await page.route('**/api/auth/anonymous?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'anonymous auth unavailable' }) }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^(直接开始阅读|打开教材|继续学习)$/ })).toBeVisible();
  await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
});

test('E8 mobile sheet entries and pending screenshot count are visible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile');
  await mockApp(page, { initialHistory: [R1, R2] });
  await page.setViewportSize({ width: 390, height: 844 });
  await enterReader(page);
  const handle = page.getByTestId('bottom-sheet-handle');
  await handle.dispatchEvent('pointerdown', { pointerId: 11, clientY: 780 });
  await handle.dispatchEvent('pointerup', { pointerId: 11, clientY: 710 });
  await expect(page.getByText('本页旁批', { exact: true })).toBeVisible();
  await openQuestionFromHistory(page, '什么是秩？');
  await expect(page.getByText('对话视图', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '框选提问' }).click();
  await page.getByRole('menuitem', { name: '框选提问' }).click();
  await expect(page.getByText('裁剪截图', { exact: true })).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: '确认截取' }).click();
  const chatButton = page.getByRole('button', { name: /AI 旁批/ });
  await expect(chatButton).toContainText('1');
  await expect(page.getByText('本页旁批', { exact: true })).toBeVisible();
  await handle.dispatchEvent('pointerdown', { pointerId: 12, clientY: 780 });
  await handle.dispatchEvent('pointerup', { pointerId: 12, clientY: 710 });
  await expect(page.getByText('学习工具', { exact: true })).toBeVisible();
});

test('E9 dark mode toggles on both map and reader views', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await page.goto('/');
  await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /切换到暗色模式/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
  await page.getByRole('button', { name: /^(直接开始阅读|打开教材|继续学习)$/ }).click();
  await page.getByRole('button', { name: /切换到亮色模式/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false);
});

test('E10 streaming allows navigation while preserving the background task context', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, { streamDelayMs: 2000 });
  await enterReader(page);
  const bubble = await createCaptureBubble(page);
  await bubble.getByPlaceholder('想问什么？').fill('流式锁定测试');
  await bubble.getByRole('button', { name: '发送' }).click();
  await expect(bubble).toHaveAttribute('data-state', 'streaming');
  await expect(page.getByRole('button', { name: '下一页' })).toBeEnabled();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('2');
  await expect(page.locator('header select')).toBeEnabled();
  await expect(page.getByRole('button', { name: '地图' }).first()).toBeEnabled();
  await page.getByRole('button', { name: '地图' }).first().click();
  await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
  await page.getByTitle('开始阅读').click();
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('2');
  await page.waitForTimeout(2500);
  await expect(page.getByRole('button', { name: '下一页' })).toBeEnabled();
  await expect(page.locator('header select')).toBeEnabled();
});
