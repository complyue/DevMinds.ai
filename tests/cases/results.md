# 场景测试结果（最新）

## ✅ run-prompt-flow（tests/cases/run-prompt-flow.sh）

- 目标：验证后端运行流程的基础序列
- 验证点：agent.run.started → agent.run.output → agent.run.finished（通过）
- 环境：cwd=tests/units/works/unit-ws；DEVMINDS_MOCK_DIR=tests/units/works/mock-io
- 说明：当前脚本未校验 agent.run.delta（流式片段）与取消流程；这两项已在后端/前端实现，需新增配套用例。

## 📌 待补充场景

- [/ ] cancel-flow：触发 POST /api/tasks/:id/cancel，验证事件顺序
  - 期望：agent.run.cancel.requested → agent.run.cancelled（或 finished 之前被取消）
- [/ ] delta-flow：在 run-prompt-flow 基础上增加对 agent.run.delta 的检查
  - 期望：出现至少一条 delta 事件，最终仍有 agent.run.output
