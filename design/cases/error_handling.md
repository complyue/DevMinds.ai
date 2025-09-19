# 错误处理与降级（error_handling）

目的：当部分文件缺失/损坏或后端异常时，前端与后端应保持可用与可诊断性。

## 前置条件

- 任务可能处于任意阶段
- 允许人为构造损坏场景进行测试

## 场景与验证点

1. 事件文件损坏（JSONL 存在非法行）
   - UI：
     - [ ] 仍能加载可解析的其他行
     - [ ] 对损坏行给出友好提示（行号/时间附近），并不崩溃
   - 后端：
     - [ ] 返回部分可用数据，并在附加字段中报告错误摘要（行计数、示例）
2. 关键文件缺失
   - 缺 wip.md：
     - [ ] UI 提示“摘要缺失”，提供“查看原始事件”入口
   - 缺 meta.json：
     - [ ] UI 只读显示可用内容，并提示检查 .tasklogs/{taskId}/meta.json
3. 目录缺失
   - 缺 .tasklogs/{taskId}/：
     - [ ] UI 不崩溃，提示“任务事件未初始化”
4. WS 中断
   - [ ] UI 切换为轮询或静默降级，仅更新可读文件
5. 权限问题（读取失败）
   - [ ] 清晰错误信息，指向具体路径与权限

## 诊断信息约定

- API 发生异常时：

```json
{
  "ok": false,
  "message": "events parse error",
  "details": {
    "file": ".tasklogs/T-1/events-20250918.jsonl",
    "line": 102,
    "snippet": "{bad json...}"
  }
}
```

- UI 弹出/提示区显示 message，控制台打印 details（不泄漏敏感数据）

## 不做的功能（本阶段）

- 不自动恢复或修复损坏文件
- 不删除任何历史数据

## 检查命令

```bash
sed -n '1,5p' .tasklogs/{taskId}/events-$(date +%Y%m%d).jsonl
head -n 200 .tasklogs/{taskId}/events-*.jsonl | jq . # 期望对坏行报错，其余可解析
```
