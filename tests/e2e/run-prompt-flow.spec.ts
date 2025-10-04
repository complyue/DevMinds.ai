import { test, expect } from '@playwright/test';

test('run-prompt-flow (headed + manual checkpoint)', async ({ page, request }) => {
  // 访问 DEMO 任务页面
  await page.goto('/tasks/DEMO');

  // 人工介入：打开 Inspector 并暂停，您可在此手动观察/操作（点击 Run、输入 prompt、Cancel 等）
  await page.pause();

  // 自动步骤示例：点击“Run”按钮并等待状态变化（根据实际 UI 文案调整选择器）
  const runButton = page.getByRole('button', { name: /run/i });
  await runButton.click();

  // 验证状态接口可用
  const res = await request.get('http://localhost:5175/api/tasks/DEMO/status');
  expect(res.ok()).toBeTruthy();
  const status = await res.json();
  expect(['idle', 'follow', 'run']).toContain(status.state);

  // 发送一次 prompt
  const promptInput = page.locator('textarea, input').first();
  await promptInput.fill('Hello from Playwright demo');
  const promptButton = page.getByRole('button', { name: /submit|prompt/i });
  await promptButton.click();

  // 观察 WS 流式事件在 UI 中逐片出现（示例：有“delta”文本或事件区域追加）
  const streamArea = page.locator('text=delta').first();
  await expect(streamArea).toBeVisible({ timeout: 30_000 });
});
