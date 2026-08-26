import { Buffer } from 'node:buffer';
import { expect, test, type Page } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function mockAppApi(page: Page) {
  // 这些用例验证图片/公式流程本身；欢迎说明由专门的前端回归用例覆盖。
  await page.addInitScript(() => localStorage.setItem('learnmath.welcome.dismissed', '1'));
  await page.route('**/api/auth/anonymous?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      access_token: 'photo-token', token_type: 'bearer', user_id: 'photo-user',
      username: 'anonymous', is_anonymous: true,
    }),
  }));
  await page.route('**/api/chat/history/**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 204 });
  });
  await page.route('**/api/learning-map/chapters?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      textbook_id: 'gaodai_shang',
      chapters: [{
        chapter: '第1章', node_count: 1,
        status_counts: { unexplored: 0, learning: 0, basically_mastered: 0, mastered: 1, needs_review: 0 },
        exploration_progress: { explored: 1, total: 1 },
      }],
    }),
  }));
  await page.route('**/api/learning-map/nodes?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      textbook_id: 'gaodai_shang', chapter: '第1章',
      sections: [{ section: '1.1', nodes: [{ node_id: 'n1', name: '线性方程组', section: '1.1', status: 'mastered', closed_evidence_count: 1, blocked: false, chat: { id: null, available: false } }] }],
    }),
  }));
}

async function openChat(page: Page, projectName: string) {
  await page.getByRole('button', { name: /^(直接开始阅读|打开教材|继续学习)$/ }).click();
  if (projectName === 'chromium-mobile') {
    await page.getByRole('button', { name: 'AI 旁批', exact: true }).evaluate(element => (element as HTMLButtonElement).click());
    await expect(page.getByText('本页旁批', { exact: true })).toBeVisible();
  }
}

async function selectPhoto(page: Page, projectName: string, file = { name: 'problem.png', mimeType: 'image/png', buffer: PNG }) {
  await page.getByRole('button', { name: '添加图片' }).click();
  const actionName = projectName === 'chromium-mobile' ? '相册识别' : '上传图片识别';
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: actionName }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(file);
  await expect(page.getByRole('dialog', { name: '图片预览' })).toBeVisible();
  await expect(page.getByAltText('待识别图片')).toBeVisible();
}

test('plus menu exposes the correct desktop and mobile photo actions', async ({ page }, testInfo) => {
  await mockAppApi(page);
  await page.goto('/');
  await openChat(page, testInfo.project.name);
  await page.getByRole('button', { name: '添加图片' }).click();
  if (testInfo.project.name === 'chromium-mobile') {
    await expect(page.getByRole('menuitem', { name: '拍照识别' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '相册识别' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '上传图片识别' })).toHaveCount(0);
  } else {
    await expect(page.getByRole('menuitem', { name: '上传图片识别' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '拍照识别' })).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: '添加图片' })).toBeHidden();
});

test('mixed recognition edits and inserts at the mapped bookmark without auto-send', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockAppApi(page);
  let recognizeRequests = 0;
  await page.route('**/api/formula/recognize-content', async route => {
    recognizeRequests += 1;
    await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        blocks: [
          { type: 'text', text: '价格是$5，求' },
          { type: 'formula', latex: 'x^2', display_mode: 'inline' },
          { type: 'formula', latex: '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', display_mode: 'block' },
        ],
        warnings: ['请核对矩阵内容'],
      }),
    });
  });

  await page.goto('/');
  await openChat(page, testInfo.project.name);
  const composer = page.locator('.formula-prosemirror').last();
  await composer.fill('前后');
  await composer.evaluate(element => {
    const text = element.querySelector('p')?.firstChild;
    if (!text) return;
    const range = document.createRange();
    range.setStart(text, 1); range.collapse(true);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  });
  await selectPhoto(page, testInfo.project.name);
  await page.getByRole('button', { name: '识别内容' }).click();
  await composer.evaluate((element: HTMLElement) => element.focus());
  await page.keyboard.type('新增');

  const card = page.getByRole('dialog', { name: '识别结果' });
  await expect(card).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('photo-recognition-desktop.png'), fullPage: true });
  expect(recognizeRequests).toBe(1);
  await expect(card.getByText('请核对矩阵内容')).toBeVisible();
  await card.getByRole('button', { name: '放大查看原图' }).click();
  await expect(page.getByRole('dialog', { name: '原图大图' })).toBeVisible();
  await page.getByRole('button', { name: '关闭大图' }).click();
  await card.locator('textarea').fill('价格是$5，计算');
  await card.getByRole('button', { name: /编辑第/ }).first().click();
  const formulaField = card.locator('math-field');
  await formulaField.evaluate((element: any) => { element.value = 'x^3'; element.dispatchEvent(new InputEvent('input', { bubbles: true })); });
  await card.getByRole('button', { name: '确认' }).click();
  const blockMode = card.getByRole('group', { name: '第 3 个公式显示方式' });
  await blockMode.getByRole('button', { name: '行内' }).click();
  await expect(blockMode.getByRole('button', { name: '行内' })).toHaveAttribute('aria-pressed', 'true');
  await blockMode.getByRole('button', { name: '独立' }).click();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await card.getByRole('button', { name: '复制内容' }).click();
  const clipboardTypes = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const types = items[0]?.types || [];
    const markdown = types.includes('text/markdown')
      ? await (await items[0].getType('text/markdown')).text()
      : await navigator.clipboard.readText();
    return { types, markdown };
  });
  expect(clipboardTypes.types).toContain('text/plain');
  expect(clipboardTypes.markdown).toContain('价格是\\$5，计算');
  expect(clipboardTypes.markdown).toContain('$x^3$');
  await card.getByRole('button', { name: '插入聊天' }).click();

  await expect(card).toBeHidden();
  await expect(composer.locator('[data-type="inline-math"][data-latex="x^3"]')).toHaveCount(1);
  await expect(composer.locator('[data-type="block-math"]')).toHaveCount(1);
  const composerText = await composer.textContent() || '';
  expect(composerText.indexOf('前新增')).toBeLessThan(composerText.indexOf('价格是$5，计算'));
  expect(composerText.indexOf('价格是$5，计算')).toBeLessThan(composerText.indexOf('后'));
  await expect(page.locator('.chat-message')).toHaveCount(0);
  await page.getByRole('button', { name: '下一页' }).click();
  await page.getByRole('button', { name: '上一页' }).click();
  await expect(composer.locator('[data-type="inline-math"][data-latex="x^3"]')).toHaveCount(1);
});

test('recognized content does not replace an existing text selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockAppApi(page);
  await page.route('**/api/formula/recognize-content', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ blocks: [{ type: 'text', text: '插入' }], warnings: ['未检测到可确认公式'] }),
  }));
  await page.goto('/');
  await openChat(page, testInfo.project.name);
  const composer = page.locator('.formula-prosemirror').last();
  await composer.fill('原有文字');
  await composer.evaluate(element => {
    const text = element.querySelector('p')?.firstChild;
    if (!text) return;
    const range = document.createRange();
    range.setStart(text, 2); range.setEnd(text, 4);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  });
  await selectPhoto(page, testInfo.project.name);
  await page.getByRole('button', { name: '识别内容' }).click();
  await page.getByRole('dialog', { name: '识别结果' }).getByRole('button', { name: '插入聊天' }).click();
  await expect(composer).toContainText('原有插入文字');
});

test('recognition can be cancelled without losing the preview and failed requests can retry', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockAppApi(page);
  let attempt = 0;
  await page.route('**/api/formula/recognize-content', async route => {
    attempt += 1;
    if (attempt === 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: { code: 'upstream_unavailable', message: '识别服务不可用' } }) });
    }
    if (attempt === 2) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: { code: 'upstream_unavailable', message: '识别服务不可用' } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ blocks: [{ type: 'text', text: '重试成功' }], warnings: ['未检测到可确认公式'] }) });
  });

  await page.goto('/');
  await openChat(page, testInfo.project.name);
  await selectPhoto(page, testInfo.project.name);
  await page.getByRole('button', { name: '识别内容' }).click();
  await page.getByRole('button', { name: '取消识别' }).click();
  await expect(page.getByAltText('待识别图片')).toBeVisible();
  await expect(page.getByRole('button', { name: '识别内容' })).toBeVisible();
  await page.getByRole('button', { name: '识别内容' }).click();
  await expect(page.getByRole('alert')).toContainText('识别服务不可用');
  await page.getByRole('button', { name: '识别内容' }).click();
  await expect(page.getByRole('dialog', { name: '识别结果' })).toContainText('重试成功');
});

test('photo question creates a normal page thread without crop_bbox', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockAppApi(page);
  let historyPayload: Record<string, unknown> | null = null;
  let qaBody = '';
  await page.route('**/api/chat/history', async route => {
    historyPayload = await route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'photo-chat' }) });
  });
  await page.route('**/api/qa/solve-stream', async route => {
    qaBody = (route.request().postDataBuffer() || Buffer.alloc(0)).toString('utf8');
    const body = [
      'event: content', `data: ${JSON.stringify({ text: '图片回答' })}`, '',
      'event: done', `data: ${JSON.stringify({ full_text: '图片回答', sources: [], screenshot_context_id: 'photo-context' })}`, '', '',
    ].join('\n');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });

  await page.goto('/');
  await openChat(page, testInfo.project.name);
  await selectPhoto(page, testInfo.project.name);
  await page.getByRole('button', { name: '拍题提问' }).click();
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('图片回答')).toBeVisible();
  expect(historyPayload).toMatchObject({
    marker_type: 'text', textbook_id: 'gaodai_shang', marker_y_ratio: 0,
  });
  expect(historyPayload).toHaveProperty('thumbnail');
  expect(historyPayload).not.toHaveProperty('crop_bbox');
  expect(qaBody).toContain('"textbook_id":"gaodai_shang"');
  expect(qaBody).not.toContain('"crop_bbox"');
});

test('unsupported photo format is explained and the mobile preview stays in the viewport', async ({ page }, testInfo) => {
  await mockAppApi(page);
  await page.goto('/');
  await openChat(page, testInfo.project.name);
  if (testInfo.project.name === 'chromium-desktop') {
    await page.getByRole('button', { name: '添加图片' }).click();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: '上传图片识别' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'problem.heic', mimeType: 'image/heic', buffer: Buffer.from('not-heic') });
    await expect(page.getByRole('alert')).toContainText('请改选 JPEG、PNG 或 WebP');
    return;
  }

  await selectPhoto(page, testInfo.project.name);
  const dialog = page.getByRole('dialog', { name: '图片预览' });
  const bounds = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(393);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(851);
});

test('recognized content card and formula editor stay usable on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile');
  await mockAppApi(page);
  await page.route('**/api/formula/recognize-content', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ blocks: [{ type: 'text', text: '求解' }, { type: 'formula', latex: '\\frac{x+1}{y}', display_mode: 'inline' }], warnings: [] }),
  }));
  await page.goto('/');
  await openChat(page, testInfo.project.name);
  await selectPhoto(page, testInfo.project.name);
  await page.getByRole('button', { name: '识别内容' }).click();
  const card = page.getByRole('dialog', { name: '识别结果' });
  await card.getByRole('button', { name: /编辑第/ }).click();
  await card.locator('math-field').focus();
  await page.screenshot({ path: testInfo.outputPath('photo-recognition-mobile.png'), fullPage: true });
  const bounds = await card.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(393);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(851);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
});
