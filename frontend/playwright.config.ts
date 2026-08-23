import { defineConfig, devices } from '@playwright/test';

// manim-live.spec.ts 等真实后端集成测试通过 MANIM_E2E_BASE_URL 指向已运行的
// Docker 部署（如 http://127.0.0.1:8090），此时不应再拉起本地 dev server。
const liveBaseURL = process.env.MANIM_E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: liveBaseURL || 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  ...(liveBaseURL ? {} : {
    webServer: {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  }),
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 5'] } },
  ],
});
