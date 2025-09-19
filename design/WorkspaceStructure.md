# DevMinds.ai 工作区结构设计（WorkspaceStructure）

本设计定义 DevMinds.ai 运行时的工作区目录结构、命名约定、文件生命周期与读写规则，用于指导（测试驱动的）开发。

注意：本文档仅聚焦工作区内容本身，不涉及鉴权、部署等与目录结构无关的主题。

DevMinds.ai 依据工作区中的 .minds（AI 团队心智：团队定义、技能、知识与任务摘要等，建议纳入版本控制）通过调用 LLM（包含 tool call）具身为项目团队，与用户交互，共同推动项目开发全生命周期；.tasklogs 记录协作过程的原始事件（建议加入 .gitignore）；工作区中其余文件/目录为项目资产（最终代码/文档/资源等，对应交付物与用户资产）。

## 1. 目录总览

- 工作区 = 一个根目录（由用户选定）
- AI 团队 = .minds 子目录树（AI 团队心智：团队定义、技能、知识与任务摘要等，建议纳入版本控制）
- 开发历史 = .tasklogs 子目录树（协作过程的原始事件与消息流，建议加入 .gitignore）
- 项目资产 = 工作区中其它文件与子目录树（最终代码/文档/资源等，对应交付物与用户资产）

```
workspace-root/
├─ .minds/
│  ├─ config/
│  │  └─ providers.json               # Provider 模板选择与环境变量名等配置（不含密钥明文）
│  ├─ skills/
│  │  └─ {skill}/
│  │     ├─ def.md                    # 技能定义（可缺省，缺省表示使用内置定义）
│  │     ├─ knowledge.md              # 领域知识/速记（可由 Agent/用户维护）
│  │     └─ lessons.md                # 经验沉淀/教训（Agent 在使用过程中补充）
│  └─ tasks/
│     └─ {taskId}/
│        ├─ plan.md                   # 任务分解/步骤
│        ├─ wip.md                    # 当前任务摘要（每轮 LLM 后更新；覆盖或追加均可）
│        └─ caveats.md                # 本任务特有注意事项（仅存在于 task 级）
├─ .tasklogs/
│  └─ {taskId}/
│     ├─ meta.json                    # 元数据（创建时间、agents、skill、模型等）
│     ├─ events-YYYYMMDD.jsonl        # 顶层任务的事件与原始消息（JSON Lines）
│     └─ subtasks/
│        └─ {childTaskId}/
│           ├─ meta.json
│           ├─ events-YYYYMMDD.jsonl
│           └─ subtasks/
│              └─ {grandChildTaskId}/
│                 └─ ...              # 递归结构，支持多级子任务
└─ ...（项目资产：源代码与资源）
```

要点：

- 工作区是一个根目录的抽象；.minds 定义“AI 团队”，.tasklogs 记录“开发历史”，其余皆为“项目资产”
- skills 下不包含 caveats.md；caveats 仅存在于 .minds/tasks/{taskId}/caveats.md
- .tasklogs 采用多级子任务目录结构，保证父子关系清晰与可回放（尽管我们不实现自动重放）

## 2. 文件语义与包含关系

- 摘要与原始分离：
  - 摘要：.minds/tasks/{taskId}/wip.md（以及 plan.md/caveats.md/notes.md 等）
  - 原始：.tasklogs/{taskId}/…/events-YYYYMMDD.jsonl（逐行 JSON 事件流）
- 输入上下文组成（由上层架构/Agent 使用；此处仅明确来源位置）：
  - 必含：.minds/tasks/{taskId}/(wip.md + caveats.md)
  - 必含：相关 .minds/skills/{skill}/(def.md + knowledge.md + lessons.md)
  - 以上均为“完整包含”，不做片段选读（片段化由上层策略另行定义时再约束）

## 3. .minds/ 设计与规则

- 版本追踪：建议纳入 Git；便于审计与回顾心智演进。
- 写入原则：
  - wip.md：每轮 LLM 后更新（覆盖或追加均可，建议带轮次编号或时间戳小节）
  - lessons.md：当形成可迁移经验时追加；knowledge.md 用于通用知识沉淀
  - caveats.md（task 级）：记录任务特有注意事项；技能级不设 caveats.md
- 命名与引用：
  - taskId 与 skill 名称建议使用短而稳定的 ID（如 nanoid、短横线风格）
  - 可在 plan.md 记录本任务依赖的 skills 列表，便于 UI 与 Agent 选择上下文

## 4. .tasklogs/ 设计与规则

- 版本追踪：建议 .gitignore（可在初次启动时提示用户写入忽略规则）
- 内容范畴：
  - 原始对话消息（用户/Agent/LLM）
  - 工具调用事件（读/写文件、执行命令、LLM 请求/响应摘要、错误等）
- 文件格式：
  - JSON Lines（.jsonl）；每行结构建议包含：
    - ts（ISO8601）、taskId、agentId、type、payload、spanId、parentSpanId
- 目录与命名：
  - 顶层任务：.tasklogs/{taskId}/events-YYYYMMDD.jsonl
  - 多级子任务：.tasklogs/{taskId}/subtasks/{childTaskId}/subtasks/{...}/events-YYYYMMDD.jsonl
  - meta.json 存放任务元数据
- 异常处置（简化策略）：
  - 不提供自动恢复或幂等重放机制
  - UI 尽量加载并展示可解析内容；若发现异常/损坏，提示用户手工检查相关文件

## 5. 并发与写入安全

- 任务级串行：同一 taskId 的写操作应串行化，以避免冲突
- 原子写：采用临时文件写入后 rename 覆盖，尽量避免中断导致的半成品
- 最小互斥：进程内互斥或队列即可；不处理跨进程锁（由“单进程单工作区”保障）

## 6. WebUI（H5 复刻 opencode 的 TUI）映射

- 任务树：
  - 左侧展示任务树（含多级子任务）；节点点击展开显示轮次列表
- 对话过程：
  - 右侧为线性消息/事件流，按时间顺序渲染
  - 支持 Markdown 渲染、代码高亮、diff/patch 内嵌视图
  - 提供跳转至对应 .tasklogs 行的便捷链接（用于定位原始事件）
- 概览优先：
  - 默认读取 wip.md 展示任务摘要；需要细节时再定位到原始事件

## 7. Provider 配置（工作区侧）

- 主要来源：.minds/config/providers.json（工作区级优先）
- 模板仅声明供应商类型、baseUrl、API Key 的环境变量名与可用模型清单
- 不在工作区内存储明文密钥

## 8. 初始化与目录维护

- 首次启动/首次使用建议行为：
  - 若 .minds 或 .tasklogs 缺失则创建对应目录
  - 若 .minds/config/providers.json 缺失，可写入一份模板（仅包含结构与 env 名称占位）
  - 若 .gitignore 缺失 .tasklogs/ 规则，提示用户加入：
    - .tasklogs/
- 任务创建建议（参考高层 CLI 行为，不在本文件定义命令语义）：
  - 新建任务时：分配 {taskId}，写入 .tasklogs/{taskId}/meta.json，初始化 .minds/tasks/{taskId}/(wip.md, plan.md, caveats.md)

## 9. 命名、ID 与时间线习惯

- taskId：建议使用短 UUID（如 nanoid），避免过长路径
- agentId：primary 或 skill-xxx-n（仅作事件标注）
- 时间戳：ISO8601；可附带递增序号以稳定排序
- wip.md 原则：不维护历史沿袭（包括轮次信息），仅反映任务推进的当前状态
  - 特殊情况：当存在多轮子任务且上层任务需要评价总结既往子任务执行效果，以指导后续子任务分配时，可在 wip.md 中保留简短评述（非完整历史），其它情况后续补充细化

## 10. 与 design/cases/ 的 TDD 连接

- 为关键场景编写 Given-When-Then 步骤，并将断言绑定到工作区结构：
  - 初始化目录 -> 检查 .minds/.tasklogs 存在性与 providers.json 模板
  - 新建任务 -> 检查 .minds/tasks/{taskId} 与 .tasklogs/{taskId}/meta.json
  - 产生一轮对话 -> 检查 wip.md 更新与 events-YYYYMMDD.jsonl 追加
  - 创建子任务 -> 检查 .tasklogs/{taskId}/subtasks/{childTaskId}/… 结构与 meta.json
  - 发生异常 -> UI 提示并可定位到异常文件

## 11. 兼容性与迁移

- 与现有项目共存：不破坏现有项目资产目录结构
