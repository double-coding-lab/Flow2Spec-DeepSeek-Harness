# Flow2Spec for DeepSeek Harness

Flow2Spec 的 DeepSeek Harness 原生插件。Harness 用户安装并启用插件后即可获得 Flow2Spec 的项目知识路由、Skills、原生 Hooks、命令、工具、协作身份和 Doctor，无需再执行 `npx flow2spec init`。

Flow2Spec Core 仍是唯一业务能力来源。Cursor、Claude Code、Codex 等其他 AI 开发工具继续使用原有 Flow2Spec CLI，二者共享同一套 `.Knowledge/` 和 `flow2spec.config.json`。

> DeepSeek Harness 当前仍处于开发者预览阶段。本插件 `1.0.0` 固定验证 `@deepseek-ai/dsh@0.1.0-rc.6`、Cordis `4.0.1` 和 Flow2Spec Core `3.4.x`。

## 安装

要求 Node.js `^22.19.0 || >=24.0.0`。

```bash
npm install @double-coding/flow2spec-deepseek-harness
```

在 Harness 的 `cordis.yml` 插件列表中加入：

```yaml
- id: flow2spec
  name: '@double-coding/flow2spec-deepseek-harness'
  config:
    autoInitialize: true
```

完整配置见 [`examples/cordis.yml`](examples/cordis.yml)。首次 Session 会以 `native-host` 模式增量建立项目基线；不会生成 `.dsh/skills`，也不会覆盖已有业务知识。

## 能力

- 通过 `ctx.skills.registerProvider()` 提供 Core 中的全部 Flow2Spec Skills。
- 按 `match -> expand -> verify -> loadContext` 注入有限、可追溯的项目上下文。
- 使用 `agent/session-start`、`agent/pre-step`、`agent/request`、`tools/pre-execute`、`tools/result` 和 `session/event` 原生扩展点。
- 自动解析 `developerId` 与 `.task/<developerId>/`，共享 `.Knowledge/` 事实层。
- 监听配置与知识库变化，及时失效路由和 Skill 缓存。
- Doctor 识别宿主/Core 不兼容、路由问题和旧 `.dsh/skills/f2s-*` 覆盖。
- 卸载只注销 Provider、命令、工具和监听器，不删除项目知识、配置、任务或用户 DSH 内容。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/flow2spec status` | 查看插件、Core、项目、语言、协作与知识状态 |
| `/flow2spec init` | 显式执行 native-host 增量初始化 |
| `/flow2spec doctor` | 运行 Core 与 Harness 插件诊断 |
| `/flow2spec route <请求>` | 查看路由匹配、依赖展开和验证结果 |
| `/flow2spec kb check` | 严格校验知识库 |
| `/flow2spec kb build` | 重建路由并再次严格校验 |
| `/flow2spec update` | 强制检查 Core 更新 |

## 模型工具

只读工具：`flow2spec_route`、`flow2spec_doctor`、`flow2spec_kb_status`、`flow2spec_kb_check`。

受控写工具：`flow2spec_kb_plan`、`flow2spec_kb_apply`、`flow2spec_kb_build`、`flow2spec_project_init`。知识写入必须先取得稳定 `planHash`；delta 改变、计划过期或 revision 冲突时拒绝执行。工具不接受任意写入路径，也不绕过 Harness 自身审批和策略层。

## 配置

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `locale` | `auto` | 使用项目语言，或指定 `zh-CN` / `en-US` |
| `autoInitialize` | `true` | 首次使用时增量初始化项目基线 |
| `strictCompatibility` | `true` | 对未验证宿主/Core 契约失败关闭 |
| `skills.rank` | `250` | Provider 优先级；项目级同名 Skill 仍可覆盖 |
| `routing.injectContext` | `true` | 将验证通过的有限知识注入动态上下文 |
| `routing.maxFiles` | `20` | 单次路由最多加载文件数 |
| `routing.maxLines` | `400` | 单次路由最多加载行数 |
| `hooks.*` | `true` | 启动摘要、版本检查和配置前置提醒 |
| `commands.enabled` | `true` | 注册 `/flow2spec` |
| `tools.readOnly` | `true` | 注册只读工具 |
| `tools.knowledgeWrite` | `true` | 注册受控知识写工具 |

## 旧项目

已执行过 `flow2spec init dsh` 的项目可直接启用插件，`.Knowledge/` 和配置会被复用。项目中的 `.dsh/skills/f2s-*` 优先级高于插件资源，Doctor 会提示这些旧副本；插件不会自动删除它们。完成核对后再由项目维护者决定是否移除。

## 开发

插件与 Core 并行开发时，先在相邻目录准备 Flow2Spec 主仓，然后使用本地 Core：

```bash
npm install --no-save --package-lock=false ../Flow2Spec/packages/core
npm run check
npm run pack:install
```

`npm run pack:install` 会分别打包本地 Core 和插件，在临时目录完成真实安装与 ESM 入口验证。

## 兼容矩阵

| 插件 | Flow2Spec Core | DeepSeek Harness | Cordis | Node.js |
| --- | --- | --- | --- | --- |
| `1.0.x` | `3.4.x` | `0.1.0-rc.6` | `4.0.1` | `22.19+` / `24+` |

升级 Harness rc 版本前必须重新运行完整 CI、Cordis 加载/卸载、Provider、路由、命令、工具和 npm pack 安装测试。

## License

ISC
