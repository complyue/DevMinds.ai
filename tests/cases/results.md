# 场景测试结果（最新）

## ✅ run-prompt-flow（tests/cases/run-prompt-flow.sh）

- 目标：验证后端运行流程的基础序列
- 验证点：agent.run.started → agent.run.output → agent.run.finished（通过）
- 环境：cwd=tests/units/works/unit-ws；DEVMINDS_MOCK_DIR=tests/units/works/mock-io
- 说明：当前脚本未校验 agent.run.delta（流式片段）与取消流程；这两项已在后端/前端实现，需新增配套用例。

## ✅ cancel-flow（tests/cases/cancel-flow.sh）

- 目标：触发取消并验证事件顺序
- 验证点：agent.run.cancel.requested → agent.run.cancelled；完成后状态回退为 follow/idle（通过）
- 环境：cwd=tests/units/works/unit-ws；DEVMINDS_MOCK_DIR=tests/units/works/mock-io
- 说明：统一入口 scripts/run-case-tests.sh 可一键运行

## ✅ delta-flow（tests/cases/delta-flow.sh）

- 目标：验证流式片段与最终输出一致性
- 验证点：累计 payload.delta 片段与 agent.run.output 的 payload.content 完全一致（通过）
- 指标：片段数与最终输出长度记录示例（如 4 片段，最终 244 bytes）
- 环境：cwd=tests/units/works/unit-ws；DEVMINDS_MOCK_DIR=tests/units/works/mock-io
- 说明：脚本在每次运行前清理 tests 工作区 .tasklogs/{taskId}，避免历史事件影响

## ✅ ws-reconnect-flow（tests/cases/ws-reconnect-flow.sh + tests/e2e/ws-reconnect.spec.ts）

- 目标：通过杀后端进程并稍后重启，验证前端的 WS 指数退避重连与事件补齐能力
- 验证点：UI 显示“重连中（第 n 次，退避中）”→ 恢复“● 实时连接”；最终“已完成合并并输出最终内容”
- 机制：bash 控制后端启动/杀死/重启，Playwright 驱动浏览器观察与断言
- 环境：后端 cwd=tests/units/works/unit-ws；DEVMINDS_MOCK_DIR=tests/units/works/mock-io；前端 Vite dev（:5173）

## ✅ tool-cancel-flow（tests/cases/tool-cancel-flow.sh + tests/e2e/tool-cancel.spec.ts）

- 目标：前端通过“工具触发”参数化指令启动运行，中途取消并验证提示与状态回退
- 验证点：触发后出现 agent.run.delta（≥1 片）；POST /cancel 成功；出现 agent.run.cancelled；状态回退为 follow/idle；前端 toast 提示显示（通过）
- 环境：后端 cwd=tests/units/works/unit-ws；DEVMINDS_MOCK_DIR=tests/units/works/mock-io；前端 Vite dev（:5173）

## ✅ events-pagination-flow（tests/cases/events-pagination-flow.sh + tests/e2e/events-pagination.spec.ts）

- 目标：事件分页与日期范围 UI 的数据一致性与交互正确性
- 验证点：设置 limit 后显示事件数与 offset 提示；“下一页”使 offset 增加；“上一页”使 offset 减少且不小于 0；应用 dateFrom/dateTo 后 offset 重置为 0（通过）
- 环境：后端 cwd=tests/units/works/unit-ws；DEVMINDS_MOCK_DIR=tests/units/works/mock-io；前端 Vite dev（:5173）
