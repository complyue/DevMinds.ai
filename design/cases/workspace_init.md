# 工作区初始化（workspace_init）

目的：定义首次运行时的文件/目录与配置模板创建规则，确保最小可用工作区。

## 前置条件

- 运行路径：项目根目录（含 .git/）
- 首次运行或“未初始化”状态：
  - 不存在 .minds/ 与 .tasklogs/
  - 不存在 .minds/provider.yaml
- 操作者具备对工作区写权限

## 操作步骤（TDD 场景）

1. 启动应用（或执行初始化命令）
   - 例如：devminds init（命令名示例，实际以实现为准）
2. 应用检测并创建基础结构：
   - 创建 .minds/ 与 .tasklogs/ 两个目录（若不存在）
   - 生成 .minds/provider.yaml（模板，且不含任何密钥）
3. 校验 .gitignore 规则存在或提示添加：
   - 至少包含：
     - .tasklogs/

## 预期验证点

- 目录存在：
  - [ ] .minds/ 存在
  - [ ] .tasklogs/ 存在
- provider.yaml 模板：
  - [ ] 路径：.minds/provider.yaml
  - [ ] YAML 合法，可被解析
  - [ ] 不包含密钥/令牌字段值（仅字段占位或为空）
  - 建议模板示例：

```yaml
providers:
  openai:
    models:
      - gpt-4o-mini
      - gpt-4.1
    baseUrl: ''
    apiKeyEnvVar: OPENAI_API_KEY
notes: '不要在此文件存储真实密钥；该文件仅声明 provider 模板与模型清单；密钥通过环境变量提供。'
```

- .gitignore：
  - [ ] 包含 .tasklogs/
  - 若缺失，应用应提示并提供一键追加或拷贝片段

## 负例与边界

- 若 .minds/ 已存在但 provider.yaml 缺失：
  - [ ] 仅生成 provider.yaml，不覆盖其他内容
- 若 .git 目录不存在（非 Git 项目）：
  - [ ] 允许继续初始化，但提示版本管理缺失的风险
- 权限不足：
  - [ ] 友好报错，并指向需要的目录权限

## 检查命令（便于手测）

```bash
ls -la .minds .tasklogs
cat .minds/provider.yaml
grep -E "^\s*\.tasklogs/|^\s*\.tasklogs/\*\*/\*\.jsonl" .gitignore
```
