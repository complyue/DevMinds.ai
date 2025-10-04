import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  retries: 0,
  outputDir: process.env.RUN_ID
    ? `tests/e2e/.runs/${process.env.RUN_ID}`
    : `tests/e2e/.runs/latest`,
  use: {
    baseURL: 'http://localhost:5173',
    headless: false,
    launchOptions: { slowMo: 100 },
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'bash /ws/AiWorks/DevMinds.ai/scripts/dev-servers.sh',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
});
