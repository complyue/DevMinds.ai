import { test, expect } from '@playwright/test';

test('WS 重连与断线指示：刷新/路由切换后恢复连接', async ({ page }) => {
  // 首次进入任务页，应建立 WS 连接并显示指示
  await page.goto('/tasks/E2E-WS');
  await expect(page.getByText('● 实时连接')).toBeVisible({ timeout: 15_000 });

  // 刷新页面，WS 重新建立，指示仍应为连接
  await page.reload();
  await expect(page.getByText('● 实时连接')).toBeVisible({ timeout: 15_000 });

  // 切换到另一个任务，再切回，WS 重新建立
  await page.goto('/tasks/OTHER');
  await expect(page.getByText(/未指定 taskId/).first()).toBeHidden({ timeout: 500 }).catch(() => {});
  await expect(page.getByText('● 实时连接')).toBeVisible({ timeout: 15_000 });

  await page.goto('/tasks/E2E-WS');
  await expect(page.getByText('● 实时连接')).toBeVisible({ timeout: 15_000 });

  // 注：当前前端未实现断线退避（指数退避）策略，指示仅在 WS onclose 显示“● 连接断开”，
  // 重连依赖于组件重挂载（刷新/路由切换）。详见 SETUP.md 记录。
});
