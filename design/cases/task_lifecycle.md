# 任务全生命周期（task_lifecycle）

目的：定义“新建任务 → 产生轮次 → WIP 更新”的基础文件契约与验证点。

## 前置条件

- 工作区已初始化（参见 workspace_init）
- UI 或 API 可触发新建任务
- 时间以本地时区或 UTC 统一，命名规范需稳定

## 操作步骤（TDD 场景）

1. 新建任务（通过 UI 或 POST /api/tasks）
   - 输入：标题/描述等最小元信息
2. 检查任务资源创建：
   - .minds/tasks/{taskId}/ 目录
   - 生成文件：wip.md, plan.md, caveats.md（可为空模板）
   - .tasklogs/{taskId}/meta.json 初始化
3. 进行一次对话轮次（可最小回合）
   - 产生事件流记录（见 conversation_round）
   - 轮次结束后更新 wip.md（覆盖或追加策略需固定）
4. 再次打开任务
   - UI 默认读取 wip.md 摘要
   - 可从 UI 跳转定位到原始事件

## 预期验证点

- 任务目录与文件：
  - [ ] .minds/tasks/{taskId}/wip.md 存在
  - [ ] .minds/tasks/{taskId}/plan.md 存在
  - [ ] .minds/tasks/{taskId}/caveats.md 存在
- meta.json（基线结构示例）：

```json
{
  "taskId": "20240918-001",
  "title": "示例任务",
  "createdAt": "2025-09-18T09:00:00Z",
  "status": "active",
  "parentTaskId": null,
  "links": {
    "wip": ".minds/tasks/20240918-001/wip.md"
  }
}
```

- 首轮结束后的成果：
  - [ ] .minds/tasks/{taskId}/wip.md 内容有更新
  - [ ] .tasklogs/{taskId}/events-YYYYMMDD.jsonl 存在至少一行事件
  - [ ] meta.json 的基本字段可被 UI 消费

## 轮次更新策略

- 推荐：覆盖式写入 wip.md 的“当前最新摘要”；历史留存在事件文件（JSONL）
- UI 可提供“历史回放”定位到具体 JSONL 事件位置

## 负例与边界

- 任务重复创建（同 id）：
  - [ ] 应拒绝或生成新 id，不能覆盖既有目录
- 写入中断：
  - [ ] 允许 meta.json 存在而 wip.md 临时为空；UI 提示“任务初始化未完成”
- 清理策略（非本阶段实现）：
  - [ ] 暂不自动清理历史事件，仅在设置页提供清理入口

## 检查命令

```bash
test -f .minds/tasks/{taskId}/wip.md
cat .tasklogs/{taskId}/meta.json | jq .status
ls .tasklogs/{taskId}/events-*.jsonl
```
