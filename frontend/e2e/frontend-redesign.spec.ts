import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const chapter = {
  chapter: '第1章',
  node_count: 1,
  status_counts: { unexplored: 0, learning: 0, basically_mastered: 0, mastered: 1, needs_review: 0 },
  exploration_progress: { explored: 1, total: 1 },
};

type MockOptions = { initialHistory?: Record<string, unknown>[]; streamDelayMs?: number };

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
  await page.route('**/api/learning-map/chapters?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ textbook_id: 'gaodai_shang', chapters: [chapter] }),
  }));
  await page.route('**/api/learning-map/nodes?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ textbook_id: 'gaodai_shang', chapter: '第1章', sections: [{ section: '1.1', nodes: [{ node_id: 'n1', name: '线性方程组', section: '1.1', status: 'mastered', closed_evidence_count: 1, blocked: false, chat: { id: null, available: false } }] }] }),
  }));
  await page.route('**/api/textbook/section-page?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ page: 26, confidence: 1, matched_text: '1.1' }) }));
  await page.route('**/api/chat/history**', async route => {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(history) });
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
      `data: ${JSON.stringify({ full_text: '先观察系数矩阵的秩。', sources: [], tool_activities: [] })}`,
      '',
      '',
    ].join('\n');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
}

async function enterReader(page: Page) {
  await page.goto('/');
  await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '直接开始阅读' }).click();
  await expect(page.getByRole('button', { name: '框选提问' }).first()).toBeVisible();
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
  await expect(bubble.getByRole('button', { name: '关闭框选提问' })).toBeDisabled();
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
  test.setTimeout(90_000);
  await mockApp(page);
  await page.addInitScript(() => localStorage.clear());
  const artifactDir = resolve(process.cwd(), '..', 'artifacts', 'visual-20260818');
  await mkdir(artifactDir, { recursive: true });

  const capture = async (scene: string, width: number, dark: boolean) => {
    await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
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
  await page.locator('summary').filter({ hasText: '什么是秩？' }).getByRole('button', { name: '打开' }).click();
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
  const posts: Record<string, unknown>[] = [];
  const patches: Record<string, unknown>[] = [];
  page.on('request', request => {
    if (request.method() !== 'POST' && request.method() !== 'PATCH') return;
    if (!request.url().includes('/api/chat/history')) return;
    const data = request.postDataJSON?.();
    if (request.method() === 'POST') posts.push(data);
    else patches.push(data);
  });
  await enterReader(page);
  await page.locator('summary').filter({ hasText: '什么是秩？' }).getByRole('button', { name: '打开' }).click();
  await page.getByRole('button', { name: '返回本页' }).click();
  await page.getByRole('textbox', { name: '输入问题…' }).fill('新问题');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('先观察系数矩阵的秩。')).toBeVisible();
  await expect.poll(() => posts.length).toBeGreaterThan(0);
  expect(posts.at(-1)?.page_number).toBe(1);
  await page.getByRole('textbox', { name: '输入问题…' }).fill('追问一句');
  await page.getByRole('button', { name: '发送' }).click();
  await expect.poll(() => patches.some(item => typeof item.follow_ups === 'string')).toBe(true);
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
  await expect(page.getByRole('dialog', { name: '学习工具' })).toBeHidden();
  await expect(page.getByText('拖动鼠标框选区域，按 ESC 取消')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('拖动鼠标框选区域，按 ESC 取消')).toBeHidden();
});

async function createCaptureBubble(page: Page, nearRightEdge = false) {
  await page.getByRole('button', { name: '框选提问' }).first().click();
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
  await page.locator('summary').filter({ hasText: '什么是秩？' }).getByRole('button', { name: '打开' }).click();
  await expect(page.getByText('秩是矩阵中线性无关行（列）的最大数。')).toBeVisible();
  await page.locator('header').getByRole('button', { name: '地图' }).click();
  await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
  await page.locator('header').getByTitle('开始阅读').click();
  await expect(page.getByText('对话视图', { exact: true })).toBeVisible();
  await expect(page.getByText('秩是矩阵中线性无关行（列）的最大数。')).toBeVisible();
});

test('E7 chapter navigation enters the reader for both scan hits and misses', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await page.goto('/');
  await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
  const sectionRequest = page.waitForRequest(request => request.url().includes('/api/textbook/section-page'));
  await page.locator('main button').filter({ hasText: '第1章' }).last().click();
  await sectionRequest;
  await expect(page.getByRole('button', { name: '框选提问' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('26');
});

test('E7 chapter navigation falls back without a blank reader on a scan miss', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page);
  await page.unroute('**/api/textbook/section-page?*');
  await page.route('**/api/textbook/section-page?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ page: null, confidence: 0, matched_text: null }) }));
  await page.goto('/');
  await expect(page.getByText('学习地图', { exact: true }).first()).toBeVisible();
  await page.locator('main button').filter({ hasText: '第1章' }).last().click();
  await expect(page.getByRole('button', { name: '框选提问' })).toBeVisible();
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
  await page.locator('summary').filter({ hasText: '什么是秩？' }).getByRole('button', { name: '打开' }).click();
  await expect(page.getByText('对话视图', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '框选提问' }).click();
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
  await page.getByRole('button', { name: '直接开始阅读' }).click();
  await page.getByRole('button', { name: /切换到亮色模式/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false);
});

test('E10 streaming locks page, textbook and view navigation while preserving the page label', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockApp(page, { streamDelayMs: 2000 });
  await enterReader(page);
  const bubble = await createCaptureBubble(page);
  await bubble.getByPlaceholder('想问什么？').fill('流式锁定测试');
  await bubble.getByRole('button', { name: '发送' }).click();
  await expect(bubble).toHaveAttribute('data-state', 'streaming');
  await expect(page.getByRole('button', { name: '下一页' })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: '当前页码' })).toHaveValue('1');
  await expect(page.locator('header select')).toBeDisabled();
  await expect(page.getByRole('button', { name: '地图' }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: '框选提问', exact: true })).toBeDisabled();
  await expect(bubble).toHaveAttribute('data-state', 'complete', { timeout: 5000 });
  await expect(page.getByRole('button', { name: '下一页' })).toBeEnabled();
  await expect(page.locator('header select')).toBeEnabled();
});
