# workspace_init

## 目的
首次运行时，按 WorkspaceStructure.md 要求初始化工作区目录与基础文件。

## 前置条件
- 选定的 workspace 根目录为空或缺少 .minds/ 与 .tasklogs/
- 无 .minds/config/providers.json

## 场景
Given 目标工作区尚未初始化
When 启动 devminds serve 或首次初始化流程
Then
- 创建 .minds/ 与 .tasklogs/ 目录
- 若缺失，生成 .minds/config/providers.json 模板（不含任何密钥明文）
- 提示 .gitignore 包含:
  - .tasklogs/
  - .tasklogs/**/*.jsonl

## 断言
- 目录与文件实际存在
- providers.json 结构正确、无密钥
- 控制台或 UI 有友好提示

## 备注
- 不做自动写入 .gitignore，仅提示
