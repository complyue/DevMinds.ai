# 会话轮次与事件记录（conversation_round）

目的：约定事件流的持久化与 UI 行为，使之可被回放与溯源。

## 前置条件

- 已存在任务 {taskId}
- WS 通道 /ws 可推送事件；REST 可读取 WIP

## 操作步骤（TDD 场景）

1. 触发一次对话轮次（用户提交 prompt）
2. 轮次期间：
   - 可能发生多次 tool call、agent 问答
   - 支持中断信号（interrupt），在流式/工具调用检查点可停止
3. 轮次完成后：
   - 生成/追加当天事件文件：.tasklogs/{taskId}/events-YYYYMMDD.jsonl
   - 更新 wip.md 摘要（覆盖或追加，策略需与生命周期文档一致）
4. UI 默认展示 wip.md，并可跳转定位原始事件记录

## 事件文件规范

- 路径：.tasklogs/{taskId}/events-YYYYMMDD.jsonl
- 每行一个 JSON，对象结构（基线，与 DevTracker 中“数据契约”一致）：

```json
{
  "ts": "2025-09-18T09:05:03.123Z",
  "taskId": "20240918-001",
  "agentId": "assistant#default",
  "type": "message.appended",
  "payload": {
    "role": "assistant",
    "content": "本次轮次的响应片段……"
  },
  "spanId": "s-001",
  "parentSpanId": null
}
```

- 允许的 type 示例：task.updated, message.appended, tool.started, tool.ended, interrupt
- 要求时间戳单调递增（同一文件内），用于回放时序

## 中断行为

- 当收到 interrupt：
  - [ ] 写入一条 type=interrupt 的事件
  - [ ] 尝试结束在途 span；若无法保证一致性，仍需保证文件可解析
  - [ ] 轮次应进入“终止完成”状态，UI 给出提示

## UI 行为验证

- [ ] 默认读取并显示 .minds/tasks/{taskId}/wip.md
- [ ] 打开“查看原始对话”时，按事件顺序回放对应 JSONL
- [ ] 支持按 spanId/parentSpanId 折叠查看 tool 调用

## 负例与边界

- 跨天对话：
  - [ ] 事件应写入新日期的 JSONL 文件
- 多并发轮次（不推荐）：
  - [ ] 至少保证事件可区分不同轮次的 span 根（parentSpanId=null 的根 span）
- 写入失败：
  - [ ] 保证已写入的文件行保持完整 JSON，不出现半行

## 检查命令

```bash
wc -l .tasklogs/{taskId}/events-$(date +%Y%m%d).jsonl
tail -n 5 .tasklogs/{taskId}/events-$(date +%Y%m%d).jsonl
jq -r '.type + "@"+ .spanId' .tasklogs/{taskId}/events-*.jsonl | head
```
