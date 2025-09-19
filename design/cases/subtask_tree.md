# 子任务树与父子关联（subtask_tree）

目的：定义子任务目录结构、父子关联的 meta.json 契约，以及 UI 侧定位行为。

## 前置条件

- 已存在父任务 {taskId}
- 支持创建子任务（UI 或 API）

## 操作步骤（TDD 场景）

1. 在父任务中创建子任务 {childTaskId}
2. 检查目录结构：
   - .tasklogs/{taskId}/subtasks/{childTaskId}/
   - 其中包含 meta.json 与事件文件
3. 检查父子 meta 关联
4. 在 UI 左侧任务树展开并定位子任务的轮次记录

## 目录与文件

- 父：
  - .tasklogs/{taskId}/meta.json
  - .minds/tasks/{taskId}/wip.md
- 子：
  - .tasklogs/{taskId}/subtasks/{childTaskId}/meta.json
  - .minds/tasks/{childTaskId}/(wip.md, plan.md, caveats.md)
  - 事件文件：.tasklogs/{taskId}/subtasks/{childTaskId}/events-YYYYMMDD.jsonl

## meta.json 字段示例

- 父 meta.json 片段：

```json
{
  "taskId": "T-ROOT",
  "children": [{ "taskId": "T-CH-1", "title": "子任务一", "hasMore": false }]
}
```

- 子 meta.json（位于 subtasks/{childTaskId}/）：

```json
{
  "taskId": "T-CH-1",
  "parentTaskId": "T-ROOT",
  "createdAt": "2025-09-18T09:20:00Z",
  "links": {
    "wip": ".minds/tasks/T-CH-1/wip.md"
  }
}
```

## UI 验证点

- [ ] 左侧任务树可展开父任务，显示子任务节点
- [ ] 点击子任务，中央事件流可定位子任务当日 JSONL
- [ ] 节点支持 hasMore? 提示（用于懒加载更多子级）

## 负例与边界

- 子任务被误创建在根目录：
  - [ ] 应仍能通过 parentTaskId 反向关联并警告
- 多级子任务：
  - [ ] 结构嵌套遵循相同规则（subtasks/{child}/subtasks/{grandchild}/…）

## 检查命令

- tree -a .tasklogs/{taskId}
- cat .tasklogs/{taskId}/meta.json | jq .children
- cat .tasklogs/{taskId}/subtasks/{childTaskId}/meta.json | jq .parentTaskId
