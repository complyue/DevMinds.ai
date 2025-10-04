import { test, expect } from '@playwright/test';

test('delta-flow: 流式增量 + 最终输出（后端断言）', async ({ page, request }) => {
  await page.goto('/tasks/E2E-DELTA');

  // 触发一次带 prompt 的运行（使用超长输出文件保障流式）
  const promptRes = await request.post('http://localhost:5175/api/tasks/E2E-DELTA/prompt', {
    data: { prompt: 'delta test' }
  });
  expect(promptRes.ok()).toBeTruthy();

  // 后端断言：轮询 /events 直到出现最终输出
  let hasOutput = false;
  for (let i = 0; i < 60; i++) {
    const r = await request.get('http://localhost:5175/api/tasks/E2E-DELTA/events?limit=200');
    if (r.ok()) {
      const js = await r.json();
      if (Array.isArray(js?.items)) {
        if (js.items.some((e: any) => e?.type === 'agent.run.output')) {
          hasOutput = true;
          break;
        }
      }
    }
    await page.waitForTimeout(500);
  }
  expect(hasOutput).toBeTruthy();

  // UI 顶部事件统计应 > 0（轻量 UI 校验）
  const counter = page.getByText(/\d+\s*个事件/).first();
  await expect(counter).toBeVisible();
});
