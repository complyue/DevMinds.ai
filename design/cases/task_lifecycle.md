# task_lifecycle

## 目的
验证任务从创建到完成一轮交互的基本生命周期。

## 前置条件
- 已完成 workspace_init

## 场景
Given 发起创建任务
When 系统分配 {taskId} 并初始化任务
Then
- 生成 .minds/tasks/{taskId}/(wip.md, plan.md, caveats.md)
- 写入 .tasklogs/{taskId}/meta.json
- 完成一轮交互后，wip.md 更新（覆盖或追加均可）
- 事件文件 .tasklogs/{taskId}/events-YYYYMMDD.jsonl 存在

## 断言
- 文件路径与命名符合规范
- meta.json 字段基本正确（如创建时间、agents 等）
- wip.md 内容更新符合“当前状态摘要”原则

## 备注
- wip.md 不保留完整历史，仅当前摘要
