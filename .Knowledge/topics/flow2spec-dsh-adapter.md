---
id: flow2spec-dsh-adapter
revision: 8
summary: "DeepSeek Harness 项目级技能初始化与目录适配"
primary: feature
confidence: inferred
tags: [module]
---
# DeepSeek Harness 集成

用于原生插件安装、知识路由、Hooks、工具、旧项目兼容与发布链路判断。

## 适用场景

- 安装或发布 `@double-coding/flow2spec-deepseek-harness`。
- 排查 `dsh plugin`、`dsh.bundle`、`cordis.patch.yml`、`.dsh/skills` 或 `flow2spec init dsh`。
- 判断 Harness 原生插件与 Flow2Spec CLI/Core 的职责边界。

## 正式安装

- 插件包必须在 `package.json` 声明 `dsh.bundle.patch`，并把根 `cordis.patch.yml` 纳入 npm 产物。
- `cordis.patch.yml` 通过包名插入 Flow2Spec Cordis 插件行；配置未显式给出时使用插件 schema 默认值。
- 用户使用 `dsh plugin --profile <profile> add @double-coding/flow2spec-deepseek-harness` 安装；`dsh plugin` 维护 profile 依赖与 bundle 列表。
- desktop 客户端换 DSH 版本时会重建 profile：`package.json` 依赖与 `pnpm-lock.yaml` 被重置，但 `cordis.patch.yml` 里已有的 `- id: flow2spec` 行会留下。该行随即成为悬空条目，宿主报 `failed to import`；重新 `dsh plugin --profile desktop add ...` 装上包即恢复。
- 用户无需手工编辑 Harness 的 `cordis.yml`；profile 自有 patch 仅用于本地覆盖。
- 安装路径有两条，产物必须自带构建结果：registry 包（`dist/` 随 `files` 发布）与 git 规格（`github:<org>/<repo>`）。**git 安装时 pnpm 按 `files` 字段打包，而 `dist/` 是构建产物、不在 git 中**，所以包必须声明 `prepare` 脚本；否则装出的包只有 `LICENSE` / `README.md` / `assets` / `cordis.patch.yml` / `docs` / `examples` / `package.json`，缺 `dist/index.js`，宿主只报 `failed to import`（`dsh: 1 entry did not activate ...`），不提示缺文件。desktop 端默认走 git 规格，`~/.dsh/profiles/<profile>/pnpm-lock.yaml` 里的 `codeload.github.com/...` 即该路径。

## 能力边界

- 原生插件负责 Cordis Provider、动态知识路由、生命周期 Hooks、`/flow2spec` 命令、Core 工具和 Doctor。
- `@double-coding/flow2spec-core` 是唯一业务能力来源；插件保持宿主适配薄层。当前依赖 `^3.8.2`，能力协议仍是 `2`。
- 首次 Session 默认以 `native-host` 模式增量初始化项目基线，不生成 `.dsh/skills`，不覆盖已有业务知识。
- 已验证宿主范围写在 `src/version.ts` 的 `VERIFIED_HOST_RANGE`，随上游 DeepSeek Harness rc 升级；当前基线是 `0.2.0-rc.2`。peer 依赖按上游约定改为精确锁版本（`0.2.0-rc.2`），Cordis 用 `~4.0.4`。
- 知识路由只读取用户消息里的文本块；Harness 收图或模型看图都不进入选题。

## 0.1.7-rc.2 集成点

- 宿主生命周期事件 `agent/session-start` 已被移除，改用 `agent/created`（payload 仍是 `{ agent, source, signal }`）。
- `@deepseek-ai/dsh-tools` 不再透出 `JsonValue`，改从 `@deepseek-ai/dsh-util-values` 引入。
- `@deepseek-ai/dsh-settings` 移除了 `installSettingsSection` / `settingsNamespace`；插件已不再依赖该包，插件配置表单由宿主从 Loader 条目 schema 自动派生。
- 客户端设置入口从 `settings.plugin.item` 槽位迁移到 `settings.plugins.tab`（Plugins 设置区的标签页），注册选项用 `id` / `order` / `label`，`useWorkspaces` 成为该槽位的标准 prop。
- 卡片 RPC 不走 `connection.rpc.handle()`：该 API 在本基线不可用（其内部经 connection 服务自身 context 访问 `webServer`，而该 context 未声明 inject，必然抛 `cannot get property "webServer" without inject`）。插件改为在 `ctx.webServer` 注册 `/flow2spec` 前缀路由，并用 `connection.admit` 保留信任围栏与浏览器鉴权，自行桥接 node:http ↔ Fetch 信封（`{type:'server-response', rpcId, result}`）。上游修好该 API 后可回落标准写法。
- 卡片的「检查更新」与工作区配置读写都经这条路由；已在本基线宿主中验证状态、更新检查、配置读取与保存的完整往返。

## 0.2.0-rc.2 集成点

- 依赖整体上移到 `0.2.0-rc.2`：peer 与 dev 精确锁版本，`schemastery` 仍为 `~3.18.4`、Cordis 仍为 `~4.0.4`（新基线各包的 peer 声明未变）。`VERIFIED_HOST_RANGE` 改为 `>=0.2.0-rc.2 <0.3.0`，0.1.x 宿主不再受支持。源码对比 0.1.7-rc.2 为纯增量改动，插件逻辑无需调整。
- **宿主逐字插值所有 system prompt context**：`ctx.systemPrompt.context()` 的文本无条件走 `interpolate()`；`{{name}}` 必须满足 `/^[a-z][a-z0-9_]*$/` 且已在宿主注册，否则抛错并终止整轮会话。context 没有 `interpolate: false` 逃生口（只有 section 有）。因此知识主题正文里的模板占位符（如 `{{FLOW2SPEC_PROJECT_CONFIG}}`）会让整轮对话直接失败。
- 插件在注入前净化：`renderRoutingContext` 的返回文本经 `neutralizePromptVariables`——先解开简单 `{{ name }}` 组为裸名，再把 2 个及以上连续 `{` 拆开，保证注入文本不含 `{{`；`}}` 保留不动，避免破坏正文里的代码示例（宿主只在遇到 `{{` 时才进入变量扫描）。
- 上述占位符仍存在于 Core 模板 `templates/{zh-CN,en-US}/knowledge/topics/f2s-config-precheck.md`；模板修复前，`init` 生成的新库主题正文仍会带花括号，只能靠插件侧净化兜底。

## Core 3.8.2 集成点

- 公共契约与 3.5.0 完全一致：`index.d.ts` 与 `capabilities.json` 逐字节相同（`protocolVersion` 仍为 `2`，25 项能力覆盖插件要求的 20 项），插件侧无需改代码，只把依赖下限提到 `^3.8.2`。
- 直接继承的行为变更（插件经 Core API 生效、本身不感知实现）：matcher 分片新增 `includeAll` / `excludeAny` / `excludeAll`，排除词命中即整条规则出局，task 精确命中也不例外；`taskToTopicRules[].summary` 成为初筛召回字段，唯一手写源是 topic frontmatter 的 `summary`，由 `kb build` / `kb apply` / `kb status` 机械同步，手改 manifest 会被判 routing drift。
- `init` / `doctor` 新增 `plugin` 虚拟目标（`root: null`，只落 `.Knowledge` 与 `flow2spec.config.json`）；插件模式下缺根 `AGENTS.md` 或配置根由 error 降级为 warning。插件的 `native-host` 模式仍是 `ids = []`，行为不变。
- `kb check` 对 topic `summary` 新增 missing / placeholder / too-long 三类 warning（默认不阻断，`--strict` 才影响结果）；本仓库 6 个模板 topic 的占位 summary 已同步为 3.8.2 模板文案。

## 旧项目兼容

- 已执行 `flow2spec init dsh` 的项目继续复用 `.Knowledge/` 和 `flow2spec.config.json`。
- 旧 `.dsh/skills/f2s-*` 优先级高于插件资源，Doctor 提示覆盖；插件不自动删除用户文件。

## 发布契约

- `prepare` 必须保留（`npm run build`）：registry 安装不触发它，git 安装靠它产出 `dist/`。
- npm 包版本与 Git Tag 必须一致：`package.json` 的 `x.y.z` 对应 `vx.y.z`。
- Tag 触发 GitHub Actions 校验、npm Trusted Publishing 和 GitHub Release；首次创建 npm 包可手工引导，后续版本统一走 OIDC 工作流。
