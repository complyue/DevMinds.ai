# Playwright E2E（可视化 + 可介入）本机配置与验证

## 目标

- 在本机以 headed（可视化）模式运行 E2E 测试；
- 支持在测试过程中通过 `page.pause()` 人工介入；
- 一键启动前后端与 E2E，遵循 tests 工作区隔离与 TDD 原则。

## 安装

1. 安装依赖：
   - `pnpm add -D @playwright/test`
2. 安装浏览器：
   - `npx playwright install`

> 注意：使用 pnpm 工作区，依赖安装在根包。

## 运行

- 可视化运行：
  - `pnpm playwright test --headed`
- 进入调试（Inspector）：
  - `pnpm playwright test --debug`
- 交互式选择用例：
  - `pnpm playwright test --ui`

Playwright 配置：`tests/e2e/playwright.config.ts`，将前端+后端通过 `scripts/dev-servers.sh` 一并启动；仅以前端 5173 的就绪作为 webServer 就绪标志。

## 手动观察与介入

- 用例中含 `await page.pause()`，运行时会弹出 Inspector 并暂停；
- 您可在浏览器中直接操作（点击 Run/Prompt/Cancel），然后在 Inspector 中继续执行。

## 可能问题与解决记录

- 如果 5175 后端未就绪导致前端代理报错：
  - 已在脚本中 `sleep 2`，如仍不稳定可调大；
- 端口被占用：
  - 关闭占用进程或修改各包 `dev` 端口配置；
- 选择器不匹配真实 UI：
  - 更新 `run-prompt-flow.spec.ts` 中的 `getByRole/locator` 文案，使其与当前组件一致；
- CI 环境下需 headless：
  - 在配置中通过 `reuseExistingServer: !process.env.CI` 控制复用；CI 可将 `use.headless` 置 true。
- pnpm 工作区根未安装 @playwright/test 导致“Command 'playwright' not found”：
  - 使用 `pnpm -w add -D @playwright/test @types/node` 安装到 workspace root；
  - 若此前运行了 `npx playwright install`，它只下载浏览器，不等同安装 @playwright/test。
- webServer 在 tests/e2e 下执行导致 `pnpm -C packages/...` 解析为 `tests/e2e/packages`：
  - 将 `scripts/dev-servers.sh` 改为使用仓库绝对路径 `cd /ws/AiWorks/DevMinds.ai/packages/...` 再执行 `pnpm dev`。
- 冲突：EADDRINUSE（5175/5173 被占用）导致 webServer 启动失败：
  - 在 `scripts/dev-servers.sh` 中检测端口是否被占用（lsof），若已运行则跳过启动该服务；
  - 这样 Playwright 的 `reuseExistingServer: !process.env.CI` 能复用现有服务，避免端口冲突。
- “No tests found”：
  - 由于配置文件位于 `tests/e2e`，`testDir` 也设置为 `tests/e2e`，路径叠加后变成 `tests/e2e/tests/e2e`；
  - 将 `testDir` 改为 `.`（相对配置文件目录）即可识别到 `*.spec.ts` 用例。
- TypeScript 报错 “Cannot find module '@playwright/test' / Cannot find name 'process'”：
  - 安装 `@playwright/test` 与 `@types/node` 后重试；
  - Playwright 配置 TS 文件无需单独 tsconfig，Playwright 会处理。

## 一键脚本（可选）

- 直接运行（推荐）：`pnpm exec playwright test --headed --config tests/e2e/playwright.config.ts`
- 或先启动服务器，再单测：
  - `bash scripts/dev-servers.sh`（另开终端）
  - `pnpm exec playwright test --headed --config tests/e2e/playwright.config.ts`

> 说明：
>
> - `pnpm playwright` 不是有效调用方式；请使用 `pnpm exec playwright ...` 或在 `package.json` 添加脚本后 `pnpm run test:e2e`。
