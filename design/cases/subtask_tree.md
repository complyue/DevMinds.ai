# subtask_tree

## 目的
验证多级子任务目录结构与 UI 展示。

## 前置条件
- 已存在父 {taskId}

## 场景
Given 在父任务中创建子任务
When 分配 {childTaskId} 并初始化
Then
- 生成 .tasklogs/{taskId}/subtasks/{childTaskId}/… 结构
- 各级 meta.json 存在且父子关联正确
- UI 左侧任务树可展开定位到子任务轮次

## 断言
- 路径结构与命名符合规范
- 子任务事件文件按日期分片写入
- 展开/折叠与路由跳转正确

## 备注
- 支持多级嵌套结构
