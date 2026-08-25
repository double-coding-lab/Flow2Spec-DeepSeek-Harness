---
id: flow2spec-dsh-adapter
revision: 4
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
- 用户无需手工编辑 Harness 的 `cordis.yml`；profile 自有 patch 仅用于本地覆盖。

## 能力边界

- 原生插件负责 Cordis Provider、动态知识路由、生命周期 Hooks、`/flow2spec` 命令、Core 工具和 Doctor。
- `@double-coding/flow2spec-core` 是唯一业务能力来源；插件保持宿主适配薄层。当前依赖 `^3.5.0`，能力协议仍是 `2`。
- 首次 Session 默认以 `native-host` 模式增量初始化项目基线，不生成 `.dsh/skills`，不覆盖已有业务知识。
- 已验证宿主范围写在 `src/version.ts` 的 `VERIFIED_HOST_RANGE`，随上游 DeepSeek Harness rc 升级；当前基线是 `0.1.1-rc.2`。 peer 依赖必须同步到同一条线，`^0.1.0-rc.x` 不会匹配 `0.1.1-rc.*`。
- 知识路由只读取用户消息里的文本块；Harness 收图或模型看图都不进入选题。

## 旧项目兼容

- 已执行 `flow2spec init dsh` 的项目继续复用 `.Knowledge/` 和 `flow2spec.config.json`。
- 旧 `.dsh/skills/f2s-*` 优先级高于插件资源，Doctor 提示覆盖；插件不自动删除用户文件。

## 发布契约

- npm 包版本与 Git Tag 必须一致：`package.json` 的 `x.y.z` 对应 `vx.y.z`。
- Tag 触发 GitHub Actions 校验、npm Trusted Publishing 和 GitHub Release；首次创建 npm 包可手工引导，后续版本统一走 OIDC 工作流。
