# “.minds 配置工具”设计（provider / skillset / task-team）

目标：以内部 Agent 工具（非公开 HTTP）读写工作区 .minds 下的关键配置，具备校验、原子写与测试工作区隔离，符合当前设计“不提供前端配置 UI；通过内部工具在 .minds 下读写”。

## 1. 配置范围与文件位置

- Provider（工作区级）：
  - .minds/provider.yaml（运行时覆盖 built-in 模板 packages/backend/config/known-providers.yaml）
- Skillset（技能定义）：
  - .minds/skills/{skill}/def.md（YAML frontmatter：providerId、model；或回退行内格式）
  - 扩展：knowledge.md、lessons.md（只读展示，不在本工具内更新）
- Task-team（任务团队）：
  - .minds/tasks/{taskId}/team.md（YAML frontmatter：defaultMember、members[{id, skill}]）
  - .minds/tasks/{taskId}/wip.md（由运行流更新摘要，配置工具仅在初始化时创建模板）

## 2. 工具接口（内部）

- 名称：minds.config.read / minds.config.update
- 参数（read）：
  - target: 'provider' | 'skilldef' | 'team'
  - keys: { providerId?; skill?; taskId? }
- 参数（update）：
  - target: 同上
  - keys: 同上
  - patch: 对应结构的部分更新（对象或字符串），采用“合并/替换”策略
- 返回：
  - ok: boolean
  - data?: 解析后的结构（provider 合并结果、def/team 的结构化体）
  - warnings?: 解析/校验告警
- 事件：
  - update 操作将写入 agent.run.delta（开始/校验）、agent.run.output（完成/摘要）到 .tasklogs

## 3. 解析与校验

- provider.yaml：
  - 加载 YAML（js-yaml），校验 providers.\*.apiType/baseUrl/models/apiKeyEnvVar 等字段类型。
  - 合并策略：与内置模板深度合并；数组（models）采用“运行时优先”。
- def.md：
  - 优先解析 YAML frontmatter，字段 providerId（必填）、model（可选）。
  - 回退解析：行内 "Provider: ..."、"Model: ..."。
- team.md：
  - 解析 YAML frontmatter，defaultMember（可选）、members 列表（id/skill 均必填）。
  - 回退解析：`json fenced block` 的 members/默认成员。

## 4. 更新写入策略

- 原子写：
  - write_temp = `${file}.tmp` → fs.writeFile → fs.rename(temp, file)
- 并发控制：
  - 以 taskId/skill 为维度的操作队列，避免交叉写入。
- 内容生成：
  - provider.yaml：合并内存结构后序列化为 YAML，保持缩进与键顺序的稳定。
  - def.md/team.md：保留 Markdown 主体，更新 frontmatter；若无 frontmatter 则生成并置顶。
- 校验失败：
  - 返回 ok=false + warnings，不落盘；写入 agent.run.error 事件。

## 5. 测试工作区隔离（遵循规则）

- 所有测试必须以 tests/units/works/unit-ws 为 cwd，读写其 .minds 下的文件；
- 禁止测试触及产品包路径的 .minds；
- 使用环境变量（如 DEVMINDS_MOCK_DIR）指向 tests 下的 mock 目录；
- 工具实现中通过 process.cwd() 作为 repoRoot，路径计算统一走 server.ts 的 paths.minds/paths.tasklogs。

## 6. 与后端现有机制的衔接

- loadRuntimeProviderConfig/loadProviderTemplate：读取与合并逻辑保持一致；
- runRealAgent：优先使用 team/def 来解析成员/技能与 providerId/model；更新工具需确保这些文件的结构合法；
- 事件：所有更新操作追加到 .tasklogs/{taskId}/events-YYYYMMDD.jsonl，并通过 WS 广播（message.appended）。

## 7. 未来拓展

- 增加 skillset 的批量更新（多技能统一校验与写入）。
- provider 的连通性诊断工具（内部），基于环境变量与 HTTP 探针，写入诊断事件；仍不暴露公开路由。
- 前端配置辅助（后续版）：仅作为 YAML 编辑器与校验视图，提交将仍走内部 agent 工具。

## 8. 安全与合规

- 不写入/存储明文密钥；provider 只能引用 apiKeyEnvVar。
- 拒绝外部工作区路径；路径检查必须阻止越权。
- 更新操作必须有审计事件与失败回滚（原子写已保证）。

## 9. 与参考实现的工作区上下文约束对齐

- 参考：DevMinds.ai/../opencode/ 的工具均以 Instance.directory/worktree 作为工作区边界，所有路径校验走 Filesystem.contains()。
- 对齐策略：本工具的读写操作以 repoRoot（process.cwd()）作为 Instance.directory 等价物；任何 patch/write/team/def 更新前必须通过 contains(repoRoot, targetPath) 校验。
- 上下文传递：在未来的工具框架中，为 minds.config.read/update 提供 ctx.sessionID/messageID/agent 以便一致的事件审计与 metadata 流。
