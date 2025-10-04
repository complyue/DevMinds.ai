# DevMinds.ai 设计原则（第一性）

目标

- 面向“可视化事实”的 AI 开发协作工作台：先读后写、稳态优先、可溯源。
- 前后端解耦，以文件事实为中心（.minds/.tasklogs）逐步引入交互与自动化。

核心原则

1. 事实优先

- UI 以可读事实为基：wip.md 与 JSONL 事件文件；运行态仅做订阅与拼接，不隐藏或曲解事实。

2. 简化与稳定

- 不引入数据库与复杂队列；以本地文件和 WS 广播为主，保证可诊断与可运维。

3. 明确契约

- 数据契约、错误模型、降级路径先行；前后端遵循最小接口面，逐步扩展。

4. 安全与隐私

- 不存储密钥；Provider 配置仅含模型与占位；连接测试临时输入、不落盘。

5. 软失败

- 文件缺失/损坏不崩溃；返回部分可用数据+明确的 warnings。

6. 可回放与可定位

- 按日 JSONL、单调时序、spanId 折叠；支持从 UI 跳到原始事件。

非目标

- 不做端到端“自动修复/自愈”
- 不引入复杂多租户与配额系统
- 不追求 TUI 的一比一还原，而是“等价体验”的 Web 化

里程碑路径

- M1：只读渲染（REST/WS 读取事实）
- M2：LLM api 调用，Agent 对话可运行，少量控制（中断/新建子任务/Provider 连通性）
- M3：接入各种工具供 AI Agent 使用
- M4：CI/CD 与质量
  - 将现有 E2E 场景纳入 CI；错误监控与告警；测试结果自动汇总到 tests/\*/results.md
  - 清理废弃用例与数据；确保 .minds/.tasklogs 规则遵循“测试工作区隔离”

工程栈约束（强约束）

- 语言与运行时：Node.js LTS + TypeScript（strict 模式）
- 包管理与 Monorepo：pnpm 工作区（pnpm-workspace），统一以 pnpm 运行脚本与安装依赖
- 禁止项：
  - 不使用 Go 语言 (opencode 使用 Go 实现 TUI，我们仅做 WebUI)
  - 不使用 Bun、Yarn、npm（包管理与脚本统一采用 pnpm）
  - 不依赖全局安装工具（脚本通过本地 devDependencies 与 pnpm dlx 执行）
- 产物与脚本约定：
  - 锁文件：pnpm-lock.yaml
  - 所有子包 scripts 统一前缀与参数约定（如 dev/build/test/lint/typecheck 等）
  - Node-only：避免引入需要额外本地 runtime 的工具链（除非以可选适配器、且不影响默认开发流程）
