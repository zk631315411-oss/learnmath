import { expect, test } from '@playwright/test';

async function mockAppApi(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/anonymous?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      access_token: 'formula-token',
      token_type: 'bearer',
      user_id: 'formula-user',
      username: 'anonymous',
      is_anonymous: true,
    }),
  }));
  await page.route('**/api/chat/history/**', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
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

async function openChat(page: import('@playwright/test').Page, projectName: string) {
  await page.getByRole('button', { name: /^(直接开始阅读|打开教材|继续学习)$/ }).click();
  if (projectName === 'chromium-mobile') {
    await page.getByRole('button', { name: 'AI 旁批', exact: true }).evaluate((element) => (element as HTMLButtonElement).click());
    await page.waitForTimeout(100);
    await expect(page.getByText('本页旁批', { exact: true })).toBeVisible();
  }
}

test('converts, inserts, serializes and sends an inline formula', async ({ page }, testInfo) => {
  await mockAppApi(page);

  let formulaAuthorization = '';
  let submittedPayload = '';
  await page.route('**/api/formula/convert', async route => {
    formulaAuthorization = route.request().headers().authorization || '';
    expect(await route.request().postDataJSON()).toEqual({
      description: 'x平方加y平方等于1',
      preferred_display: 'auto',
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ latex: 'x^2+y^2=1', display_mode: 'inline' }),
    });
  });
  await page.route('**/api/chat/history', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: 'formula-chat' }),
  }));
  await page.route('**/api/qa/solve-stream', async route => {
    submittedPayload = route.request().postData() || '';
    const body = [
      'event: content',
      `data: ${JSON.stringify({ text: '已收到公式。' })}`,
      '',
      'event: done',
      `data: ${JSON.stringify({ full_text: '已收到公式。', sources: [] })}`,
      '',
      '',
    ].join('\n');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });

  await page.goto('/');
  await openChat(page, testInfo.project.name);
  await page.getByRole('button', { name: '插入公式' }).click();

  const dialog = page.getByRole('dialog', { name: '公式编辑器' });
  await dialog.getByPlaceholder('例如：x趋于0时sin x除以x的极限').fill('x平方加y平方等于1');
  await dialog.getByRole('button', { name: '转换' }).click();
  await expect(dialog.locator('math-field')).toHaveJSProperty('value', 'x^2+y^2=1');
  expect(formulaAuthorization).toBe('Bearer formula-token');
  await page.screenshot({
    path: testInfo.outputPath(`formula-editor-${testInfo.project.name}.png`),
    fullPage: true,
  });

  await dialog.getByRole('button', { name: '插入', exact: true }).click();
  await expect(page.locator('[data-type="inline-math"][data-latex="x^2+y^2=1"]')).toBeVisible();
  await page.getByRole('button', { name: '发送' }).click();

  await expect(page.getByText('已收到公式。')).toBeVisible();
  expect(submittedPayload).toContain('$x^2+y^2=1$');
  await expect(page.locator('.chat-message').filter({ hasText: 'x2+y2=1' }).locator('.katex')).toBeVisible();
});

test('formula dialog stays within the mobile viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile');
  await mockAppApi(page);
  await page.goto('/');
  await openChat(page, testInfo.project.name);
  await page.getByRole('button', { name: '插入公式' }).click();

  const dialog = page.getByRole('dialog', { name: '公式编辑器' });
  await dialog.getByRole('button', { name: '更多符号' }).click();
  const bounds = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(393);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(851);
  await expect.poll(() => dialog.locator('.formula-toolbar').evaluate(
    element => element.scrollWidth <= element.clientWidth,
  )).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('formula-editor-mobile.png'), fullPage: true });
});

test('one-shot shortcuts close after inserting and vec keeps an editable placeholder', async ({ page }, testInfo) => {
  await mockAppApi(page);
  await page.goto('/');
  await openChat(page, testInfo.project.name);
  await page.getByRole('button', { name: '插入公式' }).click();
  const dialog = page.getByRole('dialog', { name: '公式编辑器' });
  const field = dialog.locator('math-field');

  await page.keyboard.press('Control+Shift+G');
  await expect(dialog.getByRole('dialog', { name: '快捷插入' })).toBeVisible();
  await page.keyboard.press('1');
  await expect(dialog.getByRole('dialog', { name: '快捷插入' })).toBeHidden();
  await expect(field).toBeFocused();
  await field.evaluate((element: any) => { element.value = ''; element.dispatchEvent(new InputEvent('input', { bubbles: true })); });

  await dialog.getByRole('button', { name: '向量', exact: true }).click();
  await expect(field).toBeFocused();
  await page.keyboard.type('a');
  await expect(field).toHaveJSProperty('value', '\\vec{a}');

  await page.keyboard.press('Control+Shift+G');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('dialog', { name: '快捷插入' })).toBeHidden();
});

test('handwriting recognition keeps confirmation in the formula dialog', async ({ page }, testInfo) => {
  await mockAppApi(page);
  await page.route('**/api/formula/recognize', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ latex: '\\sqrt{x+1}', display_mode: 'inline' }),
  }));
  await page.goto('/');
  await openChat(page, testInfo.project.name);
  await page.getByRole('button', { name: '插入公式' }).click();
  const dialog = page.getByRole('dialog', { name: '公式编辑器' });
  await dialog.getByRole('button', { name: '手写输入' }).click();
  const recognize = dialog.getByRole('button', { name: '识别手写公式' });
  await expect(recognize).toBeDisabled();
  const canvas = dialog.getByLabel('手写公式画板');
  await canvas.evaluate(element => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: rect.left + 30, clientY: rect.top + 50 }));
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: rect.left + 30, clientY: rect.top + 50 }));
  });
  await expect(recognize).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath(`handwriting-${testInfo.project.name}.png`) });
  await recognize.click();
  await expect(dialog.locator('math-field')).toHaveJSProperty('value', '\\sqrt{x+1}');
  await expect(dialog.getByRole('button', { name: '插入', exact: true })).toBeVisible();
});

test('smart input, selection wrapping and Tab placeholders work in MathLive', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await mockAppApi(page);
  await page.goto('/');
  await openChat(page, testInfo.project.name);
  await page.getByRole('button', { name: '插入公式' }).click();
  const dialog = page.getByRole('dialog', { name: '公式编辑器' });
  const field = dialog.locator('math-field');

  await field.focus();
  await expect(field).toBeFocused();
  await page.keyboard.type('1/2');
  await expect(field).toHaveJSProperty('value', '\\frac12');

  for (const [typed, expected] of [['x^2', 'x^2'], ['x_i', 'x_{i}']] as const) {
    await field.evaluate((element: any) => { element.value = ''; element.dispatchEvent(new InputEvent('input', { bubbles: true })); element.focus(); });
    await page.keyboard.type(typed);
    await expect(field).toHaveJSProperty('value', expected);
  }
  await field.evaluate((element: any) => { element.value = ''; element.dispatchEvent(new InputEvent('input', { bubbles: true })); element.focus(); });
  await page.keyboard.type('sqrt');
  await page.keyboard.press('Space');
  await expect.poll(() => field.evaluate((element: any) => element.value)).toContain('\\sqrt');

  await field.evaluate((element: any) => { element.value = 'x+1'; element.executeCommand('selectAll'); element.dispatchEvent(new InputEvent('input', { bubbles: true })); });
  await dialog.locator('.formula-toolbar button[aria-label="根式"]').click();
  await expect(field).toHaveJSProperty('value', '\\sqrt{x+1}');

  await field.evaluate((element: any) => { element.value = ''; element.dispatchEvent(new InputEvent('input', { bubbles: true })); element.focus(); });
  await dialog.locator('.formula-toolbar button[aria-label="分数"]').click();
  await expect(field).toBeFocused();
  await page.keyboard.type('a');
  await page.keyboard.press('Tab');
  await page.keyboard.type('b');
  await expect(field).toHaveJSProperty('value', '\\frac{a}{b}');
});

test('PDF capture action recognizes a formula and prefills the editor', async ({ page }, testInfo) => {
  await mockAppApi(page);
  await page.route('**/api/formula/recognize', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ latex: '\\int_0^1 x^2\\,dx', display_mode: 'inline' }),
  }));
  await page.goto('/');
  await openChat(page, testInfo.project.name);
  await expect(page.locator('.react-pdf__Page canvas').first()).toBeVisible({ timeout: 15_000 });
  await page.getByTitle('框选操作').click();
  await expect(page.getByRole('menuitem', { name: '识别公式' })).toBeVisible();
  await page.getByRole('menuitem', { name: '识别公式' }).click();

  if (testInfo.project.name === 'chromium-mobile') {
    await expect(page.getByText('裁剪截图')).toBeVisible();
    await page.getByRole('button', { name: '确认截取' }).click();
  } else {
    await expect(page.getByText('拖动鼠标框选区域，按 ESC 取消')).toBeVisible();
    await page.mouse.move(180, 180);
    await page.mouse.down();
    await page.mouse.move(520, 360, { steps: 5 });
    await page.mouse.up();
    await page.getByTitle('确认截图').click();
  }

  const dialog = page.getByRole('dialog', { name: '公式编辑器' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.locator('math-field')).toHaveJSProperty('value', '\\int_0^1 x^2\\,dx');
});

test('formula surfaces stay framed across approved light and dark viewports', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  test.setTimeout(120_000);
  await mockAppApi(page);
  const cases = [
    { width: 1440, height: 900 }, { width: 1280, height: 800 },
    { width: 768, height: 900 }, { width: 390, height: 844 },
  ];
  for (const viewport of cases) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.waitForTimeout(250);
    if (!(await page.getByRole('button', { name: '框选提问' }).count())) {
      const start = page.getByRole('button', { name: /^(直接开始阅读|打开教材|继续学习)$/ }).first();
      await start.evaluate(element => (element as HTMLButtonElement).click());
    }
    if (viewport.width < 1024) {
      await page.getByRole('button', { name: 'AI 旁批', exact: true }).evaluate(element => (element as HTMLButtonElement).click());
    }
    await page.getByRole('button', { name: '插入公式' }).click();
    const dialog = page.getByRole('dialog', { name: '公式编辑器' });
    await dialog.getByRole('button', { name: '打开快捷插入' }).click();
    await dialog.getByRole('button', { name: '手写输入' }).click();
    const bounds = await dialog.evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(viewport.width);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
    await expect.poll(() => dialog.locator('.formula-dialog-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
      await page.screenshot({ path: testInfo.outputPath(`formula-${viewport.width}-${dark ? 'dark' : 'light'}.png`) });
    }
    await dialog.getByRole('button', { name: '关闭' }).click();
  }
});
