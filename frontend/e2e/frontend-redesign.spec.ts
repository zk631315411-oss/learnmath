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
  edges?: Array<{ source: string; target: string; type: string }>;
};

type MockOptions = {
  initialHistory?: Record<string, unknown>[];
  streamDelayMs?: number;
  mapByTextbook?: Record<string, MapFixture>;
  chapterDelayByTextbook?: Record<string, number>;
  progressFailureAttempts?: number;
  progressDelta?: Record<string, unknown>;
  staticPage?: number | null;
  manimArtifacts?: Record<string, unknown>[];
  streamArtifact?: Record<string, unknown>;
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
  let manimArtifacts = (options.manimArtifacts || []).map(item => ({ ...item }));
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
    return { textbook_id: textbookId, display_name: textbookNames[textbookId] || textbookId, catalog_version: `${textbookId}-e2e`, chapters, edges: fixture.edges || [] };
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
  await page.route('**/api/manim/artifacts**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const retry = pathname.match(/\/api\/manim\/artifacts\/([^/]+)\/retry$/);
    const item = pathname.match(/\/api\/manim\/artifacts\/([^/]+)$/);
    if (retry && route.request().method() === 'POST') {
      const id = decodeURIComponent(retry[1]);
      manimArtifacts = manimArtifacts.map(artifact => artifact.id === id
        ? { ...artifact, status: 'queued', error_code: null, error_message: null }
        : artifact);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manimArtifacts.find(artifact => artifact.id === id)) });
    }
    if (item) {
      const id = decodeURIComponent(item[1]);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manimArtifacts.find(artifact => artifact.id === id)) });
    }
    const chatId = new URL(route.request().url()).searchParams.get('chat_id');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manimArtifacts.filter(artifact => artifact.chat_id === chatId)) });
  });
  await page.route('**/mock-manim.mp4', route => route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from([]) }));
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
      ...(options.streamArtifact ? [
        'event: artifact',
        `data: ${JSON.stringify(options.streamArtifact)}`,
        '',
      ] : []),
      'event: content',
      `data: ${JSON.stringify({ text: '先观察系数矩阵的秩。' })}`,
      '',
      'event: stage',
      `data: ${JSON.stringify({ stage: 'evidence_report', text: '正在记录学习进度…' })}`,
      '',
      'event: done',
      `data: ${JSON.stringify({ full_text: '先观察系数矩阵的秩。', sources: [], tool_activities: [], qa_turn_id: 'mock-qa-turn-1', progress_delta: options.progressDelta || null, artifacts: options.streamArtifact ? [options.streamArtifact] : [] })}`,
      '',
      '',
    ].join('\n');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
}

async function installStreamSequence(page: Page, responses: Array<{ text: string; delayMs: number; progressDelta?: Record<string, unknown> | null }>) {
  let index = 0;
  await page.unroute('**/api/qa/solve-stream');
  await page.route('**/api/qa/solve-stream', async route => {
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    await new Promise(resolve => setTimeout(resolve, response.delayMs));
    const body = [
      'event: content',
      `data: ${JSON.stringify({ text: response.text })}`,
      '',
      'event: done',
      `data: ${JSON.stringify({ full_text: response.text, sources: [], tool_activities: [], qa_turn_id: `qa-${index}`, progress_delta: response.progressDelta || null })}`,
      '',
      '',
    ].join('\n');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
}

async function enterReader(page: Page) {
  await page.goto('/');
  await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /^(直接开始阅读|打开教材|继续学习|复习这一节)$/ }).first().click();
  await expect(page.getByRole('button', { name: '框选', exact: true }).first()).toBeVisible();
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
  await expect(page.getByRole('button', { name: '框选', exact: true }).first()).toBeVisible();
  await expect(page.getByText('学习地图', { exact: true }).first()).not.toBeVisible();
});

test('Manim artifact restores inside its assistant message and retry is contained', async ({ page }) => {
  await mockApp(page, {
    initialHistory: [{ ...R1, client_turn_id: 'root-turn' }],
    manimArtifacts: [{
      id: 'animation-1', chat_id: 't1', client_turn_id: 'root-turn', title: '线性变换示意',
      rationale: '观察网格和向量如何同时变化。', status: 'completed', attempt: 1, repair_count: 0,
      video_url: '/mock-manim.mp4', poster_url: null,
    }, {
      id: 'animation-2', chat_id: 't1', client_turn_id: 'root-turn', title: '失败示意',
      rationale: '失败不会影响文字回答。', status: 'failed', attempt: 1, repair_count: 1,
      error_code: 'render_failed', error_message: '动画场景执行失败，文字与公式回答仍可正常使用。',
    }],
  });
  await enterReader(page);
  await openQuestionFromHistory(page, '什么是秩？');
  const card = page.getByTestId('manim-artifact-animation-1');
  await expect(card).toBeVisible();
  await expect(card.getByText('线性变换示意')).toBeVisible();
  await expect(card.locator('video')).toBeVisible();
  await expect(card).toHaveCSS('overflow', 'hidden');
  const box = await card.boundingBox();
  expect(box?.width || 0).toBeGreaterThan(240);
  expect(box?.width || 0).toBeLessThanOrEqual(page.viewportSize()?.width || 1440);
  await page.getByRole('button', { name: '重新生成动画' }).click();
  await expect(page.getByTestId('manim-artifact-animation-2').getByText('等待渲染')).toBeVisible();
});

test('Manim artifact SSE event appears before the text answer finishes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, {
    streamDelayMs: 50,
    streamArtifact: {
      id: 'animation-stream', chat_id: 'mock-thread-1', client_turn_id: 'stream-turn', title: '函数平移',
      rationale: '观察图像位置变化。', status: 'queued', attempt: 0, repair_count: 0,
    },
  });
  await enterReader(page);
  await page.getByRole('button', { name: '这页哪里没看懂？' }).click();
  await expect(page.getByTestId('manim-artifact-animation-stream')).toBeVisible();
  await expect(page.getByText('先观察系数矩阵的秩。')).toBeVisible();
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

test('capture flows into the chat input and streams a complete answer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await enterReader(page);
  await captureToChatInput(page);
  await expect(page.getByText('截图已捕获（1/3）', { exact: true })).toBeVisible();
  const input = page.getByRole('textbox', { name: '输入问题…' });
  await input.fill('这一步为什么成立？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByAltText('用户截图')).toBeVisible();
  await expect(page.getByText('先观察系数矩阵的秩。')).toBeVisible();
  await page.getByRole('button', { name: '返回本页' }).click();
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
      return document.documentElement.classList.contains('dark') === expectedDark
        && getComputedStyle(document.body).backgroundColor === (expectedDark ? 'rgb(15, 23, 42)' : 'rgb(246, 247, 251)');
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
    await page.locator('main li').filter({ hasText: '线性方程组' }).getByRole('button', { name: '查看地图 →' }).click();
    await expect(page.getByRole('button', { name: '开始本章' })).toBeVisible();
    if (viewport.width < 640) {
      await expect(page.getByTitle('列表视图')).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: /1\.1/ }).click();
      await capture('chapter-list', viewport.width, false);
      await page.getByTitle('地图视图').click();
    }
    await expect(page.getByTestId('chapter-ladder-view')).toBeVisible();
    for (const dark of viewport.themes) await capture('chapter-overview', viewport.width, dark);
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.getByTestId('overview-section-1.1').click();
    await expect(page.getByTestId('ladder-section-1.1')).toBeVisible();
    for (const dark of viewport.themes) await capture('chapter-ladder', viewport.width, dark);
    await page.getByRole('button', { name: '返回章节总览' }).click();
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
  await captureToChatInput(page, true);
  await page.getByRole('textbox', { name: '输入问题…' }).fill('这一步为什么成立？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('先观察系数矩阵的秩。')).toBeVisible();
  const artifactDir = resolve(process.cwd(), '..', 'artifacts', 'visual-20260818');
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: resolve(artifactDir, 'capture-chat-1440-light.png'), fullPage: true });
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
  await page.getByRole('button', { name: '框选', exact: true }).first().evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.getByRole('dialog', { name: '学习工具' })).toBeHidden();
  await expect(page.getByText('拖动鼠标框选区域，按 ESC 取消')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('拖动鼠标框选区域，按 ESC 取消')).toBeHidden();
});

// 框选 → 确认截图 → 预览弹层点「提问」：截图作为待发送图片进入聊天输入区
async function captureToChatInput(page: Page, nearRightEdge = false) {
  await page.getByRole('button', { name: '框选', exact: true }).first().click();
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
  await page.getByRole('dialog', { name: '框选内容预览' }).getByRole('button', { name: '提问' }).click();
  await expect(page.getByAltText('待发送截图')).toBeVisible();
}

test('mobile capture flows into the bottom sheet chat input and completes a mocked answer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile');
  await mockApp(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await enterReader(page);
  await page.getByRole('button', { name: '框选', exact: true }).click();
  await expect(page.getByText('裁剪截图', { exact: true })).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: '确认截取' }).click();
  await page.getByRole('dialog', { name: '框选内容预览' }).getByRole('button', { name: '提问' }).click();
  await expect(page.getByAltText('待发送截图')).toBeVisible();
  const input = page.getByRole('textbox', { name: '输入问题…' });
  await input.fill('移动端这一步为什么成立？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('先观察系数矩阵的秩。')).toBeVisible();
});

test('E5 captured screenshot supports a follow-up in the right chat panel', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await enterReader(page);
  await captureToChatInput(page);
  const input = page.getByRole('textbox', { name: '输入问题…' });
  await input.fill('这一步为什么成立？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('对话视图', { exact: true })).toBeVisible();
  await expect(page.getByAltText('用户截图')).toBeVisible();
  await expect(page.getByText('先观察系数矩阵的秩。')).toBeVisible();
  await input.fill('能再给一个例子吗？');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('先观察系数矩阵的秩。').nth(1)).toBeVisible();
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
  await page.locator('main li').filter({ hasText: '线性方程组' }).getByRole('button', { name: '查看地图 →' }).click();
  await expect(page.getByRole('button', { name: '开始本章' })).toBeVisible();
  await expect(page.getByTestId('chapter-ladder-view')).toBeVisible();
  await page.getByTestId('overview-section-1.1').click();
  await expect(page.getByTestId('ladder-section-1.1')).toBeVisible();
  const sectionRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/textbook/section-page')) sectionRequests.push(request.url()); });
  await page.getByRole('button', { name: '开始本章' }).click();
  await expect(page.getByRole('button', { name: '框选', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('26');
  expect(sectionRequests).toHaveLength(0);
});

test('E7 chapter map falls back without a blank reader on a scan miss', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, { staticPage: null });
  await page.goto('/');
  await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
  await page.locator('main li').filter({ hasText: '线性方程组' }).getByRole('button', { name: '查看地图 →' }).click();
  await page.getByRole('button', { name: '开始本章' }).click();
  await expect(page.getByRole('button', { name: '框选', exact: true })).toBeVisible();
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
  await expect(page.locator('main ul').getByText('线性方程组', { exact: true })).toBeVisible();
  const legacyRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/learning-map/')) legacyRequests.push(request.url()); });

  await page.unroute('**/api/auth/anonymous?*');
  await page.route('**/api/auth/anonymous?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'e2e-token-b', token_type: 'bearer', user_id: 'e2e-user-b', username: 'anonymous-b', is_anonymous: true }) }));
  await page.evaluate(() => localStorage.removeItem('auth_token'));
  await page.reload();
  await expect(page.locator('main ul').getByText('线性方程组', { exact: true })).toBeVisible();
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
  await expect(page.locator('main ul').getByText('线性方程组', { exact: true })).toBeVisible();
  await page.locator('main li').filter({ hasText: '线性方程组' }).getByRole('button', { name: '查看地图 →' }).click();
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
  await expect(page.getByText(/矩阵秩/)).toBeVisible();
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
  await page.locator('main li').filter({ hasText: '线性方程组' }).getByRole('button', { name: '查看地图 →' }).click();
  await page.getByTestId('overview-section-1.2').click();
  await page.getByRole('button', { name: /线性方程组，学习中/ }).click();
  await page.getByTestId('node-detail-card').getByRole('button', { name: '继续学习' }).click();
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
  await page.locator('main li').filter({ hasText: '线性方程组' }).getByRole('button', { name: '查看地图 →' }).click();
  await page.getByTestId('overview-section-1.2').click();
  await page.getByRole('button', { name: /线性方程组，学习中/ }).click();
  await page.getByTestId('node-detail-card').getByRole('button', { name: '继续学习' }).click();
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('26');
  expect(sectionsRequested).toHaveLength(0);
});

test('M7 progress errors keep the static map and reading escape hatch', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, { progressFailureAttempts: 1 });
  await page.goto('/');
  await expect(page.locator('main ul').getByText('线性方程组', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(直接开始阅读|打开教材|继续学习)$/ })).toBeVisible();
  await page.getByRole('button', { name: '刷新学习地图' }).click();
  await expect(page.locator('main ul').getByText('线性方程组', { exact: true })).toBeVisible();
});

test('B1 chapter map: overview → sine ladder → inline detail card → cross-chapter chip', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  const first = {
    chapter: '第1章 线性方程组', node_count: 3,
    status_counts: { unexplored: 1, learning: 1, basically_mastered: 0, mastered: 1, needs_review: 0 },
    exploration_progress: { explored: 2, total: 3 },
  };
  const second = {
    chapter: '第2章 矩阵', node_count: 1,
    status_counts: { unexplored: 1, learning: 0, basically_mastered: 0, mastered: 0, needs_review: 0 },
    exploration_progress: { explored: 0, total: 1 },
  };
  await mockApp(page, { mapByTextbook: { gaodai_shang: {
    chapters: [first, second],
    nodesByChapter: {
      [first.chapter]: { textbook_id: 'gaodai_shang', chapter: first.chapter, sections: [{ section: '1.1 消元法', nodes: [
        { node_id: 'n1', name: '线性方程组', type: 'Concept', order: 0, section: '1.1 消元法', status: 'learning', closed_evidence_count: 1, blocked: false, chat: { id: 't1', available: true } },
        { node_id: 'n2', name: '矩阵消元法', type: 'Method', order: 1, section: '1.1 消元法', status: 'mastered', closed_evidence_count: 2, blocked: false, chat: { id: null, available: false } },
        { node_id: 'p1', name: '参数方程组题型', type: 'ProblemClass', order: 2, section: '1.1 消元法', status: 'unexplored', closed_evidence_count: 0, blocked: false, chat: { id: null, available: false } },
      ] }] },
      [second.chapter]: { textbook_id: 'gaodai_shang', chapter: second.chapter, sections: [{ section: '2.1 矩阵', nodes: [
        { node_id: 'n3', name: '矩阵', type: 'Concept', order: 3, section: '2.1 矩阵', status: 'unexplored', closed_evidence_count: 0, blocked: false, chat: { id: null, available: false } },
      ] }] },
    },
    edges: [
      { source: 'n1', target: 'n2', type: 'SUPERIOR' },
      { source: 'p1', target: 'n2', type: 'USES' },
      { source: 'n2', target: 'n3', type: 'DERIVES' },
    ],
  } } });
  await page.goto('/');
  await page.locator('main li').filter({ hasText: '线性方程组' }).getByRole('button', { name: '查看地图 →' }).click();
  await expect(page.getByTestId('chapter-ladder-view')).toBeVisible();
  // 首屏是章总览（不画图），点节行进入梯子
  await expect(page.getByTestId('overview-section-1.1 消元法')).toBeVisible();
  await page.getByTestId('overview-section-1.1 消元法').click();
  await expect(page.getByTestId('ladder-section-1.1 消元法')).toBeVisible();
  // 题型默认收起，梯子上只有核心节点
  await expect(page.getByLabel(/参数方程组题型，未探索/)).toBeHidden();
  // 点击图形 → 内联详情卡（聚焦子图 + 关系 chips）
  await page.getByLabel(/线性方程组，学习中/).click();
  const card = page.getByTestId('node-detail-card');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('focus-subgraph')).toBeVisible();
  // 出边 chip 钻取到邻居；n2 有一条通往第2章的跨章边
  await card.getByRole('button', { name: /上位于 → 矩阵消元法/ }).click();
  await expect(card.getByText(/通往 第2章 矩阵/)).toBeVisible();
  await card.getByRole('button', { name: '关闭详情' }).click();
  await expect(page.getByTestId('node-detail-card')).toBeHidden();
  // 显示题型开关：题型侧枝出现
  await page.getByText('显示题型', { exact: true }).click();
  await expect(page.getByLabel(/参数方程组题型，未探索/)).toBeVisible();
});

test('B2 mobile chapter view defaults to list and can switch to the ladder', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile');
  await mockApp(page);
  await page.goto('/');
  await page.locator('main li').filter({ hasText: '线性方程组' }).getByRole('button', { name: '查看地图 →' }).click();
  await expect(page.getByTitle('列表视图')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTitle('地图视图').click();
  await expect(page.getByTestId('chapter-ladder-view')).toBeVisible();
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
  await captureToChatInput(page);
  await page.getByRole('textbox', { name: '输入问题…' }).fill('增量状态测试');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('先观察系数矩阵的秩。')).toBeVisible();
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
  await page.getByRole('button', { name: '框选', exact: true }).click();
  await expect(page.getByText('裁剪截图', { exact: true })).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: '确认截取' }).click();
  await page.getByRole('dialog', { name: '框选内容预览' }).getByRole('button', { name: '提问' }).click();
  const chatButton = page.getByRole('button', { name: /AI 旁批/ });
  await expect(chatButton).toContainText('1');
  await expect(page.getByAltText('待发送截图')).toBeVisible();
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
  await captureToChatInput(page);
  const input = page.getByRole('textbox', { name: '输入问题…' });
  await input.fill('流式锁定测试');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible();
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
  await expect(page.getByRole('button', { name: '发送' })).toBeVisible();
  // 导航回来应直接停在对话视图，流式答案完整保留
  await expect(page.getByText('对话视图', { exact: true })).toBeVisible();
  await expect(page.getByText('先观察系数矩阵的秩。')).toBeVisible();
});

test('E11 two textbooks can answer concurrently without crossing messages', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, { mapByTextbook: {
    gaodai_shang: { chapters: [chapter], nodesByChapter: {} },
    gaodai_xia: { chapters: [{ ...chapter, chapter: '第1章 多项式' }], nodesByChapter: {} },
  } });
  await installStreamSequence(page, [
    { text: '上册后台回答。', delayMs: 1200 },
    { text: '下册快速回答。', delayMs: 120 },
  ]);
  await enterReader(page);
  await page.getByRole('button', { name: '这页哪里没看懂？' }).click();
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible();
  await page.locator('header select').selectOption('gaodai_xia');
  await page.getByRole('button', { name: '打开教材' }).click();
  await page.getByRole('textbox', { name: '输入问题…' }).fill('下册问题');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('下册快速回答。')).toBeVisible();
  await expect(page.getByText('上册后台回答。')).toHaveCount(0);
  await page.locator('header select').selectOption('gaodai_shang');
  await expect(page.getByText('上册后台回答。')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('下册快速回答。')).toHaveCount(0);
});

test('E12 a running thread is serialized while another thread remains sendable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, { initialHistory: [R1, R2] });
  await installStreamSequence(page, [
    { text: '线程一回答。', delayMs: 1100 },
    { text: '线程二回答。', delayMs: 120 },
  ]);
  await enterReader(page);
  await openQuestionFromHistory(page, '什么是秩？');
  const input = page.getByRole('textbox', { name: '输入问题…' });
  await input.click();
  await input.pressSequentially('线程一追问');
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled();
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible();
  await openQuestionFromHistory(page, '线性无关怎么判？');
  await expect(page.getByRole('button', { name: '发送' })).toBeVisible();
  await input.click();
  await input.pressSequentially('线程二追问');
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled();
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('线程二回答。')).toBeVisible();
});

test('E13 changing display surfaces never duplicates the active request', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await installStreamSequence(page, [{ text: '唯一请求完成。', delayMs: 700 }]);
  let requests = 0;
  page.on('request', request => { if (request.url().includes('/api/qa/solve-stream')) requests += 1; });
  await enterReader(page);
  await page.getByRole('button', { name: '这页哪里没看懂？' }).click();
  await page.locator('header').getByRole('button', { name: '地图' }).click();
  await page.getByTitle('开始阅读').click();
  await expect(page.getByText('唯一请求完成。')).toBeVisible();
  expect(requests).toBe(1);
});

test('E14 an interrupted stream preserves partial text and persists interrupted state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  const patches: Record<string, unknown>[] = [];
  page.on('request', request => {
    if (request.method() === 'PATCH' && /\/api\/chat\/history\/[^/]+$/.test(new URL(request.url()).pathname)) {
      try { patches.push(request.postDataJSON()); } catch { /* ignore */ }
    }
  });
  await enterReader(page);
  await page.evaluate(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes('/api/qa/solve-stream')) return nativeFetch(input, init);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(encoder.encode(`event: content\ndata: ${JSON.stringify({ text: '保留下来的部分回答。' })}\n\n`));
        setTimeout(() => controller.error(new Error('mock disconnect')), 80);
      } });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await page.getByRole('button', { name: '这页哪里没看懂？' }).click();
  await expect(page.getByText('保留下来的部分回答。')).toBeVisible();
  await expect(page.getByText(/回答中断，以上为已生成的部分回答/)).toBeVisible();
  await expect.poll(() => patches.some(item => item.generation_status === 'interrupted' && item.answer === '保留下来的部分回答。')).toBe(true);
});

test('E15 stopping generation preserves partial text and persists cancelled state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  const patches: Record<string, unknown>[] = [];
  page.on('request', request => {
    if (request.method() === 'PATCH' && /\/api\/chat\/history\/[^/]+$/.test(new URL(request.url()).pathname)) {
      try { patches.push(request.postDataJSON()); } catch { /* ignore */ }
    }
  });
  await enterReader(page);
  await page.evaluate(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes('/api/qa/solve-stream')) return nativeFetch(input, init);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(encoder.encode(`event: content\ndata: ${JSON.stringify({ text: '停止前的回答。' })}\n\n`));
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
      } });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await page.getByRole('button', { name: '这页哪里没看懂？' }).click();
  await expect(page.getByText('停止前的回答。')).toBeVisible();
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(page.getByText(/回答中断，以上为已生成的部分回答/)).toBeVisible();
  await expect.poll(() => patches.some(item => item.generation_status === 'cancelled' && item.answer === '停止前的回答。')).toBe(true);
});

test('E16 logging in cancels the previous identity task and hides its late output', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await page.unroute('**/api/auth/me');
  await page.route('**/api/auth/me', route => {
    const token = route.request().headers().authorization || '';
    const signedIn = token.includes('signed-token');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: signedIn ? 'signed-user' : 'e2e-user', username: signedIn ? 'student' : 'anonymous', is_anonymous: !signedIn }) });
  });
  await page.route('**/api/auth/login', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'signed-token', token_type: 'bearer', user_id: 'signed-user', username: 'student', is_anonymous: false }) }));
  await page.route('**/api/chat/migrate', route => route.fulfill({ status: 204 }));
  const patches: Record<string, unknown>[] = [];
  page.on('request', request => {
    if (request.method() === 'PATCH' && /\/api\/chat\/history\/[^/]+$/.test(new URL(request.url()).pathname)) {
      try { patches.push(request.postDataJSON()); } catch { /* ignore */ }
    }
  });
  await enterReader(page);
  await page.evaluate(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes('/api/qa/solve-stream')) return nativeFetch(input, init);
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
      } });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await page.getByRole('button', { name: '这页哪里没看懂？' }).click();
  await page.locator('header').getByRole('button', { name: '登录' }).click();
  const modal = page.locator('.fixed').filter({ hasText: '还没有账号？' });
  await modal.locator('input[type="text"]').fill('student');
  await modal.locator('input[type="password"]').fill('password');
  await modal.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('header').getByText('student', { exact: true })).toBeVisible();
  await expect.poll(() => patches.some(item => item.generation_status === 'cancelled')).toBe(true);
  await expect(page.getByText('这页哪里没看懂？')).toHaveCount(0);
});

test('E17 duplicate done events apply one progress revision', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  const learningChapter = { ...chapter, status_counts: { unexplored: 0, learning: 1, basically_mastered: 0, mastered: 0, needs_review: 0 } };
  await mockApp(page, { mapByTextbook: { gaodai_shang: { chapters: [learningChapter], nodesByChapter: { [learningChapter.chapter]: { textbook_id: 'gaodai_shang', chapter: learningChapter.chapter, sections: [{ section: '1.1', nodes: [{ node_id: 'n1', name: '线性方程组', section: '1.1', status: 'learning', closed_evidence_count: 1, blocked: false, chat: { id: null, available: false } }] }] } } } } });
  const delta = { textbook_id: 'gaodai_shang', catalog_version: 'gaodai_shang-e2e', revision: 2, nodes: { n1: { status: 'mastered', closed_evidence_count: 2, source_chat_id: null } } };
  await enterReader(page);
  await page.evaluate((progress) => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes('/api/qa/solve-stream')) return nativeFetch(input, init);
      const done = `event: content\ndata: ${JSON.stringify({ text: '幂等回答。' })}\n\nevent: done\ndata: ${JSON.stringify({ full_text: '幂等回答。', progress_delta: progress })}\n\nevent: done\ndata: ${JSON.stringify({ full_text: '幂等回答。', progress_delta: progress })}\n\n`;
      return new Response(done, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
  }, delta);
  await page.getByRole('button', { name: '这页哪里没看懂？' }).click();
  await page.locator('header').getByRole('button', { name: '地图' }).click();
  await expect(page.getByText('全部掌握', { exact: true })).toBeVisible();
  await expect(page.getByText('1 / 1 已探索', { exact: true })).toBeVisible();
});

test('E18 reader page restores and remains isolated when textbooks change', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await page.addInitScript(() => localStorage.setItem('learnmath.workspace.gaodai_shang', JSON.stringify({ view: 'reader', page: 7 })));
  await mockApp(page, { mapByTextbook: {
    gaodai_shang: { chapters: [chapter], nodesByChapter: {} },
    gaodai_xia: { chapters: [{ ...chapter, chapter: '第1章 多项式' }], nodesByChapter: {} },
  } });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('7');
  await page.locator('header select').selectOption('gaodai_xia');
  await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '选择教材' }).click();
  await page.getByRole('option', { name: '高等代数（上册）丘维声' }).click();
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('7');
});

test('E19 URL deep links and browser history restore the reader thread', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, { initialHistory: [R1, R2] });
  await page.goto('/?view=reader&textbook=gaodai_shang&page=2&thread=t2');
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('2');
  await expect(page.getByText('看齐次线性组合是否只有零解。')).toBeVisible();
  await page.locator('header').getByRole('button', { name: '地图' }).click();
  await expect(page).toHaveURL(/view=map/);
  await expect(page).not.toHaveURL(/thread=/);
  await page.goBack();
  await expect(page).toHaveURL(/view=reader.*textbook=gaodai_shang.*page=2.*thread=t2/);
  await expect(page.getByText('看齐次线性组合是否只有零解。')).toBeVisible();

  await page.goto('/?view=reader&textbook=gaodai_shang&page=2&thread=missing');
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('2');
  await expect(page).not.toHaveURL(/thread=missing/);
});

test('E20 keyboard paging updates the URL and ignores focused editors', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await enterReader(page);
  const pageInput = page.getByRole('textbox', { name: '当前页码' });
  await expect(pageInput).toHaveValue('1');
  await page.keyboard.press('ArrowRight');
  await expect(pageInput).toHaveValue('2');
  await expect(page).toHaveURL(/page=2/);
  const composer = page.getByRole('textbox', { name: '输入问题…' });
  await composer.focus();
  await page.keyboard.press('ArrowRight');
  await expect(pageInput).toHaveValue('2');
  await page.keyboard.press('PageDown');
  await expect(pageInput).toHaveValue('2');
});

test('P1 long formula thread remains responsive while streaming', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  const followUps = Array.from({ length: 24 }, (_, index) => ({
    turn_id: `long-${index}`,
    question: `第 ${index + 1} 个追问：为什么这个变换成立？`,
    answer: `由 $A_${index}x=b_${index}$ 可得第 ${index + 1} 步结论。`,
    thinking: null,
    tool_activities: [],
    status: 'completed',
  }));
  await mockApp(page, { initialHistory: [{ ...R1, follow_ups: followUps }] });
  await enterReader(page);
  await openQuestionFromHistory(page, '什么是秩？');
  await expect(page.locator('.chat-message')).toHaveCount(50);
  await page.evaluate(() => {
    const nativeFetch = window.fetch.bind(window);
    const gaps: number[] = [];
    let previous = performance.now();
    let profiling = true;
    const sample = (now: number) => {
      gaps.push(now - previous);
      previous = now;
      if (profiling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    (window as any).__lmFinishProfile = () => {
      profiling = false;
      return gaps;
    };
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes('/api/qa/solve-stream')) return nativeFetch(input, init);
      const encoder = new TextEncoder();
      let index = 0;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const timer = window.setInterval(() => {
            if (index < 60) {
              controller.enqueue(encoder.encode(`event: content\ndata: ${JSON.stringify({ text: `第${index + 1}步，$x_${index + 1}$。` })}\n\n`));
              index += 1;
              return;
            }
            window.clearInterval(timer);
            controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ sources: [] })}\n\n`));
            controller.close();
          }, 8);
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  const composer = page.getByRole('textbox', { name: '输入问题…' });
  await composer.fill('继续推导');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('button', { name: '停止生成' })).toBeHidden({ timeout: 15_000 });
  const gaps = await page.evaluate(() => (window as any).__lmFinishProfile() as number[]);
  const sorted = [...gaps].sort((left, right) => left - right);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  await testInfo.attach('stream-performance.json', {
    body: JSON.stringify({ samples: gaps.length, maxFrameGapMs: Math.max(...gaps), p95FrameGapMs: p95 }, null, 2),
    contentType: 'application/json',
  });
  expect(Math.max(...gaps)).toBeLessThan(350);
  expect(p95).toBeLessThan(100);
});
