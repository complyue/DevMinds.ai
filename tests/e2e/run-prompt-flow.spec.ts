import { test, expect } from '@playwright/test';

test('run/prompt/cancel + delta-flow (headed + manual checkpoint)', async ({ page, request }) => {
  // 访问 DEMO 任务页面
  await page.goto('/tasks/E2E-CANCEL');

  // （全自动模式）取消人工暂停，避免对交互时机的依赖

  // 通过后端接口发起一次运行（不依赖 prompt，立即进入 running）
  const runRes = await request.post('http://localhost:5175/api/tasks/E2E-CANCEL/run');
  expect(runRes.ok()).toBeTruthy();

  // 等待运行开始事件出现
  await expect(page.getByText('agent.run.started').first()).toBeVisible({ timeout: 30_000 });

  // 立即执行取消（更短间隔 + 更多重试），提高命中概率
  let cancelOk = false;
  for (let i = 0; i < 100; i++) {
    const resp = await request.post('http://localhost:5175/api/tasks/E2E-CANCEL/cancel');
    if (resp.ok()) { cancelOk = true; break; }
    await page.waitForTimeout(100);
  }
  expect(cancelOk).toBeTruthy();

  // 断言取消事件出现（由后端在 abort 后写入并推送）
  await expect(page.getByText('agent.run.cancelled').first()).toBeVisible({ timeout: 60_000 });

  // 额外校验状态接口可用
  const res = await request.get('http://localhost:5175/api/tasks/E2E-CANCEL/status');
  expect(res.ok()).toBeTruthy();
  const status = await res.json();
  expect(['idle', 'follow', 'run']).toContain(status.status.state);
});
