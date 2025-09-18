# conversation_round

## 目的
验证一次对话轮次的记录与展示逻辑。

## 前置条件
- 已存在 {taskId}

## 场景
Given 用户与 Agent 进行一轮问答
When 产生消息与工具调用
Then
- 以时间顺序写入 .tasklogs/{taskId}/events-YYYYMMDD.jsonl（JSONL）
- UI 默认展示 .minds/tasks/{taskId}/wip.md 摘要
- 可从 UI 跳转定位到对应原始事件

## 断言
- 事件结构包含 ts、taskId、agentId、type、payload、spanId/parentSpanId
- Markdown/代码高亮/差异视图可用
- 中断信号触发后可停止流式响应或工具调用

## 备注
- SSE/WS 都应具备鉴权校验
