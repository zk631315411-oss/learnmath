import { expect, test } from '@playwright/test';

async function mockAppApi(page: import('@playwright/test').Page) {
  await page.addInitScript(() => localStorage.clear());
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
}

async function openMobileChat(page: import('@playwright/test').Page, projectName: string) {
  if (projectName !== 'chromium-mobile') return;
  await page.locator('header select').selectOption({ index: 1 });
  await page.getByTitle('打开聊天').click();
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
  await openMobileChat(page, testInfo.project.name);
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
  await openMobileChat(page, testInfo.project.name);
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
