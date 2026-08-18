# Harness 插件设置卡片 技术方案

依据：`.Knowledge/req-docs/Harness插件设置卡片_需求澄清.md`。  
宿主基线：DeepSeek Harness `0.1.0-rc.7`（与当前插件验证矩阵一致）。

## 需求概述

- **背景**：rc.7 允许第三方插件出现在 Web「设置 → 插件配置」。本插件已有 Cordis `Config`，那些字段是实现逃逸口，不能做成产品开关。
- **目标**：插件以官方卡片出现；展示只读健康信息；提供「检查更新」。不安装、不改依赖、不把能力关掉。
- **范围**：Host 注册 settings 命名空间 + 卡片查询/检查 API；浏览器半侧自定义卡片；打包 `dsh.client`；补测试与 README 一句说明。
- **不做什么**：不上任何降低能力的开关；不编辑 `.Knowledge/` / `flow2spec.config.json`；不在卡片内执行 `npm install` / `dsh plugin add` / 项目初始化 / 知识库 apply；不另做独立管理页；不改变 `/flow2spec` 与模型工具的既有语义。

## 重点问题概述

- **配对键与产品配置必须分开**：官方卡片靠 settings **命名空间** 出现在插件配置页。若把现有 `Config` schema 注册进去，配置表层可能按 schema 画出我们明确不要的开关。因此命名空间使用**空 schema**，仅作 join key；Cordis `apply(ctx, config)` 的 `Config` 仍只从 `cordis.yml` / patch 进入，不映射到卡片。
- **卡片路径禁止自动初始化**：现有 `projectForAgent` 在 `autoInitialize: true` 时会 `project.init`。打开设置页不能因此在无 Session 的工作区写文件。状态组装走只读探测。
- **Client bundle 是第三方包自己的活**：官方 `clientBundle()` 预设未发布。本仓用等价产物：`window.__ModuleLoader__.load({ id, factory })` 的 lazy-CJS，并把 `@deepseek-ai/*` 平台模块 external。卡片自绘 UI，禁止对 `@deepseek-ai/dsh-client-ui-settings-plugins` 做值导入。
- **检查更新是报告，不是升级**：插件对 npm registry；Core 复用已有 `update.check`。有新版本只给建议操作。Core 检查若写入既有 `.Knowledge/update-check.json` 缓存，允许；无工作区则不做 Core 检查，避免为缓存而创建知识库。

## 外部依赖与内部调用

| 依赖 | 用途 |
|---|---|
| `@deepseek-ai/dsh-settings`（peer，钉 rc.7） | `settingsNamespace` / `installSettingsSection`；无 settings 服务时 Host 其它能力照常 |
| `@deepseek-ai/dsh-client-runtime` 等 client peer | 浏览器半侧 `ClientContext`、slots、locale |
| `@deepseek-ai/dsh-client-ui-settings-plugins` | **仅 type-only import**，声明 `settings.plugin.item` slot |
| npm registry | 查询 `@double-coding/flow2spec-deepseek-harness` 的 dist-tag `latest` |
| `project.api.update.check({ force: true })` | 有工作区时的 Core 更新检查（与 `/flow2spec update` 同类） |
| `inspectCompatibility` / `PLUGIN_VERSION` | 只读状态中的兼容与插件版本 |

内部：新增卡片模块；`apply()` 增补 Host 注册；不改路由、Skill、命令、工具的主路径。顺手把 `status()` 里写死的 `pluginVersion: '1.0.0'` 改为 `PLUGIN_VERSION`（与卡片同一事实源）。

## 配置

不新增用户可配产品开关，不改 `cordis.patch.yml` 默认值。

`package.json` 增补（实现时按 rc.7 实际 client 注入列表微调）：

```jsonc
{
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./client": { "types": "./dist/client/index.d.ts", "default": "./dist/client.js" }
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-settings-plugins"]
    }
  }
}
```

`files` 纳入 `dist/client.js`（及 sourcemap）。Client 构建脚本与现有 `tsc` Host 构建分开，`npm run check` 两者都跑。

Host `inject` 保持现有 `skills` / `systemPrompt` / `commands` / `tools`；settings 通过 `ctx.inject(['settings'], …)` 可选挂载，与 `installSettingsSection` 口径一致。

## 交付单元

### 卡片状态组装（`src/card/status.ts`）

只读、无副作用（不 `project.init`、不写仓库）。

**输入**：可选工作区 cwd；当前进程可解析的 Core 包；可选宿主/Cordis 版本（能从 Context 读到就传入，读不到则该项为未知，不强行失败）。

**输出**：

```ts
type ProjectBaseline = 'ready' | 'missing' | 'unlinked'

interface CardStatus {
  pluginVersion: string          // PLUGIN_VERSION
  coreVersion: string            // 插件解析到的 @double-coding/flow2spec-core
  compatibility: {
    ok: boolean
    hostSupported: boolean | undefined
    cordisSupported: boolean | undefined
  }
  projectBaseline: ProjectBaseline
  workspaceRoot?: string         // unlinked 时省略
}
```

**处理流程**：

1. 无 cwd → `projectBaseline: 'unlinked'`，仍返回插件/Core 版本与兼容信息。
2. 有 cwd → 用现有 `findProjectRoot` 只读判断根目录；存在 `flow2spec.config.json` 且存在 `.Knowledge/` 则为 `ready`，否则 `missing`。不调用 `init`。
3. 兼容：有工作区且能安全 `createFlow2Spec` 只读取 `resources.capabilities()` 时并入 Core 协议检查；Host/Cordis 版本按 `VERIFIED_*` 范围判断。失败记入 `ok: false`，不抛到卡片渲染层。

`/flow2spec status` 的 `pluginVersion` 改为同一 `PLUGIN_VERSION`，避免卡片与命令两个数。

### 检查更新（`src/card/check-update.ts`）

**输入**：`AbortSignal`；可选工作区 cwd（仅用于 Core 检查）。

**输出**：

```ts
interface VersionDiff {
  name: 'plugin' | 'core'
  current: string
  latest?: string
  updateAvailable: boolean
}

interface CheckUpdateResult {
  ok: boolean
  status: 'idle' | 'checking' | 'current' | 'available' | 'failed'
  diffs: VersionDiff[]
  suggestion?: string   // 有新版本时的人话建议，不执行
  error?: string        // 失败原因
}
```

**处理流程**：

1. 查 npm：`GET https://registry.npmjs.org/@double-coding/flow2spec-deepseek-harness/latest`（超时建议 10s，尊重 AbortSignal）。用 `semver` 比较 `PLUGIN_VERSION` 与返回 `version`。
2. 若有工作区：调用 Core `update.check({ force: true, signal })`，把 `notice` 非空视为 Core 侧「有更新信息」。无工作区：跳过 Core，不创建 `.Knowledge/`。
3. 汇总：两侧都无更新 → `current` +「已是最新」；任一侧有 → `available`，建议升级插件：`dsh plugin --profile <profile> add @double-coding/flow2spec-deepseek-harness`。**不**建议用户单独改 Core 来绕过插件兼容矩阵。
4. 网络/超时/非 2xx：`failed`，保留步骤 1 已得到的部分 diff（若有），不清空只读状态。
5. 本函数不写 `package.json`、不跑安装命令。

进行中防重入放在 Host 处理层（同一请求 inflight 时复用 Promise）。

### Host 设置缝（`src/card/settings-host.ts`，由 `apply()` 调用）

1. `const FLOW2SPEC_SETTINGS_NS = settingsNamespace('flow2spec')`。浏览器卡片 slot `key` 必须同为 `flow2spec`。
2. `installSettingsSection(ctx, FLOW2SPEC_SETTINGS_NS, EmptyCardSchema, {}, { setSource, onChange })`，`EmptyCardSchema` 为无字段 object（或仅内部占位、卡片不渲染的字段）。**禁止**传入现有插件 `Config`。
3. 若 rc.7 的 `settings.register` 仍需要 `expose: true` 才能进 Web 插件配置，实现时按已安装 `@deepseek-ai/dsh-settings@0.1.0-rc.7` 类型传入；master 若已改为「凡注册即服务」，则不必重复声明。
4. 向 Client 暴露两个操作（实现时优先 rc.7 已有的 Host↔Client remote / connection；没有稳定缝再用 `ctx.webServer.register`）：
   - `card.status` → `CardStatus`
   - `card.checkUpdate` → `CheckUpdateResult`
5. cwd：能从当前 Web/Host 会话取到工作区则传入；没有则按未关联项目处理。
6. Fiber 卸载时注销命名空间与路由，与现有 `apply()` 返回的 disposer 一起清理。

### 浏览器卡片（`src/client/`）

注册进 `settings.plugin.item`，自绘只读行 + 按钮。

**展示**：插件版本、Core 版本、宿主兼容（通过 / 未通过 / 未知）、项目基线（已建立 / 未建立 / 未关联项目）。

**按钮**：文案「检查更新」。checking 时禁用；结束后展示 `current` / `available`（含 suggestion）/ `failed`。不出现 checkbox、slider、select。

**文案**：随 Harness client `locale` 提供中/英；不读取、不展示插件 `Config.locale`。

**打包**：`dist/client.js` 必须是：

```js
window.__ModuleLoader__.load({ id: '@double-coding/flow2spec-deepseek-harness', factory: (require) => {
  var module = { exports: {} }; var exports = module.exports;
  // ...bundled client...
  return module.exports;
} });
```

平台模块走 loader `require`（external），其余依赖 inline。`npm pack` 必须包含该文件。

### 测试

| 用例 | 断言 |
|---|---|
| 无 cwd | `projectBaseline === 'unlinked'`，不创建任何项目文件 |
| 有仓库但无基线 | `missing`，不调用 init |
| 有 `flow2spec.config.json` + `.Knowledge/` | `ready` |
| npm 返回更高版本 | `available`，suggestion 含 `dsh plugin`，不出现 install 副作用 |
| npm 与当前相同且无 Core notice | `current` |
| registry 超时/5xx | `failed` 且带原因 |
| `status()` | `pluginVersion === PLUGIN_VERSION` |
| 集成 | Host 在具备 settings 时能注册 `flow2spec` 命名空间；现有 Cordis 加载/卸载用例仍通过 |

Client 视觉不强制上真实浏览器 CI；Host 契约与纯函数必须有单测。可用 nock/mock `fetch`，禁止测到真 npm。

### README

在「能力」或「安装」后加一句：安装启用后，可在 Harness Web「设置 → 插件配置」查看 Flow2Spec 状态并检查更新。不把 Cordis `Config` 表当作用户开关清单宣传。

## 交互流程

1. 用户打开「设置 → 插件配置」→ Host 已服务 `flow2spec` 命名空间 → Client 卡片挂载 → 立刻 `card.status`。
2. 用户点「检查更新」→ 按钮 checking → `card.checkUpdate` → 卡片展示结果。
3. 用户按 suggestion 在终端升级插件（本卡片不代做）。

## 异常处理

| 情况 | 处理 |
|---|---|
| 无 settings 服务（无 Web） | 不注册卡片；Skill/命令/工具不受影响 |
| 无工作区 | 基线「未关联项目」；检查更新只做插件 npm |
| 兼容未通过 | 状态如实显示；按钮仍可点 |
| 检查进行中再次点击 | 复用 inflight，不并行两次完整检查 |
| npm / Core 检查失败 | `failed` + 原因；只读状态保留 |
| Client bundle 未打进包 | 标签页可能出现空槽；`pack:check` / `pack:install` 必须拦住 |

错误码：检查失败用文案返回给卡片即可；若需结构化，新增 `F2S_DSH_UPDATE_CHECK_FAILED`，不要把失败升级成插件卸载。

## 版本与发布

此为用户可见能力，建议发 **1.1.0**（插件版本、Tag、`PLUGIN_VERSION` 一致）。兼容矩阵仍钉 Harness `0.1.0-rc.7`、Cordis `4.0.1`、Core `3.4.x`。升级 rc 前仍须重跑完整 check 与 pack 安装测试。
