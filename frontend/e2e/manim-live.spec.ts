import { expect, test } from '@playwright/test';

/**
 * Manim 动画链路的真实端到端测试（live，不 mock）。
 *
 * 与 e2e/ 下其它 spec 不同，本文件针对的是正在运行的完整 Docker 部署
 * （web + api + redis + manim-dispatcher + manim-renderer 五容器），
 * 验证「登录 → 提问 → 模型调用动画工具 → 渲染 → 前端出现视频」全链路。
 *
 * 运行方式（先 `Start-LearnMath.bat` 或 `/start` 起全套）：
 *   set MANIM_E2E_BASE_URL=http://127.0.0.1:8090
 *   npx playwright test manim-live.spec.ts --project=chromium-desktop
 *
 * 未设置 MANIM_E2E_BASE_URL 或后端未就绪时自动跳过。
 * 测试账号可用 MANIM_E2E_USER / MANIM_E2E_PASS 覆盖，默认使用共享测试账号。
 */

const BASE = process.env.MANIM_E2E_BASE_URL || '';
const USER = process.env.MANIM_E2E_USER || 'manim_e2e_test';
const PASS = process.env.MANIM_E2E_PASS || 'TestPass123!';

// 渲染 + 可能的自动修复可能超过一分钟
test.setTimeout(240_000);

test.skip(!BASE, '未设置 MANIM_E2E_BASE_URL，跳过 manim live 测试');

test.describe('manim 动画 live 链路', () => {
  test('学生提问触发二维动画并渲染出视频', async ({ page }) => {
    // 后端可达性预检，未就绪则跳过而非报错
    const up = await page.request.get(`${BASE}/`).then(r => r.ok()).catch(() => false);
    test.skip(!up, `后端 ${BASE} 不可达，跳过`);

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    // 登录
    await page.getByText(/游客登录|登录/).first().click();
    await page.locator('input[type=text]:visible').first().fill(USER);
    await page.locator('input[type=password]:visible').first().fill(PASS);
    await page.locator('button:has-text("登录"):visible').last().click();
    await expect(page.getByText(USER)).toBeVisible({ timeout: 10_000 });

    // 进入阅读页
    await page.getByText(/继续学习|阅读|打开教材|直接开始阅读/).first().click();
    const box = page.locator('textarea:visible, [contenteditable=true]:visible').first();
    await expect(box).toBeVisible({ timeout: 15_000 });

    // 提交一个会触发动画的问题
    await box.click();
    await box.fill('请用动画演示：当 a 从 0 连续变化到 1 时，抛物线 y=x^2+a 如何整体向上平移？我想直观看到曲线连续移动的过程。');
    await box.press('Enter');

    // 动画卡片出现（模型已提交后台渲染）
    const card = page.locator('[data-testid^="manim-artifact-"]').first();
    await expect(card).toBeVisible({ timeout: 90_000 });

    // 视频最终渲染完成并出现在卡片中（含可能的 LLM 自动修复时间）
    await expect(card.locator('video')).toBeVisible({ timeout: 180_000 });
  });
});
