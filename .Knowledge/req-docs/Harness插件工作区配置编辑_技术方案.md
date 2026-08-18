# Harness 插件工作区配置编辑 技术方案

> 需求依据：`.Knowledge/req-docs/Harness插件工作区配置编辑_需求澄清.md`

## 需求概述

在 Harness Web「设置 → 插件配置」的 Flow2Spec 卡片里，按工作区读写各仓库的 `flow2spec.config.json`，并为未初始化的工作区提供初始化入口。

- 卡片顶部维持现状：插件版本、Core 版本、「检查更新」。
- 卡片下部新增工作区区：从宿主已注册工作区中选一个，编辑其项目配置。
- 保存为显式动作，写盘前比对内容指纹，检出外部改动即拒绝写入。
- 写回保留文件中的未知字段。
- 不做：原始 JSON 编辑框、`/flow2spec config` 子命令、工作区注册管理、配置历史与回滚。

## 重点问题概述

### Core 不提供配置写入能力

`@double-coding/flow2spec-core@3.4.0` 的 `Flow2SpecApi.config` 只有：

```ts
config: {
  load(): Flow2SpecProjectConfig
  missingFields(): unknown[]
}
```

写入路径在 Core 侧只存在于 `project.init({ configValues })`，而 `init` 同时会写 `.Knowledge/` 等目录，不能当作「保存配置」使用。

**决策**：保存由插件适配层用 `node:fs` 自行完成（读-改-写）。Core 的 `config.load()` 会套用默认值，拿不到「文件里到底写了什么」，因此读取也走原始文件解析，`load()` 不参与本功能。

### 并发写入

同一份文件可能同时被编辑器、Agent 技能、另一个 Harness 标签页改动。

**决策**：内容指纹（原始文件字节的 SHA-256）。读取时下发，保存时回传；宿主侧重新读盘计算并比对，不一致直接拒绝，返回 `config-conflict`。不做三方合并——两边都是人的意图，猜错的代价高于让用户重新加载。

文件不存在时指纹为空串 `''`，用于表达「保存时该路径应当仍然没有文件」，使初始化与保存共用同一套前置校验。

### 保留未知字段

**决策**：保存请求只携带**改动过的叶子键路径**，不携带整份配置。宿主侧把这些路径应用到刚解析出的磁盘对象上，其余键（含我们不认识的）原样留下。这同时避免了「客户端回传一份陈旧全量配置」造成的隐性覆盖。

### 缓存失效

`Flow2SpecPluginRuntime.ensureWatchers` 已监听项目根下的 `flow2spec.config.json` 变更并调用 `invalidate(root)`，但 watcher 只对**已被某个 Agent 加载过**的项目建立。卡片可以改一个从未开过会话的仓库。

**决策**：`registerSettingsCard` 增加 `runtime` 入参，保存与初始化成功后显式调用 `runtime.invalidate(root)`。

## 外部依赖与内部调用

| 依赖 | 用途 |
|---|---|
| 宿主插槽标准 prop `useWorkspaces` | 读取已注册工作区列表；类型为 `SnapshotSelectorHook<WorkspaceListState>`，`items: readonly WorkspaceView[]`，每项含 `workspaceId` / `path` / `title` |
| `ctx.connection.rpc`（`authority: 'loopback'`） | 卡片与宿主侧通信，沿用既有 `/flow2spec` 通道 |
| `createFlow2Spec({ cwd }).project.init(...)` | 初始化，与 `/flow2spec init` 同一调用 |
| `node:fs` / `node:crypto` | 配置文件读写与指纹计算 |
| `Flow2SpecPluginRuntime.invalidate(root)` | 写盘后清缓存 |

内部调用边界：本功能不经过 `projectForAgent`（卡片没有 Agent 上下文），直接以工作区 `path` 为 cwd 操作。

## 配置

不新增插件配置项。本功能操作的是**目标工作区**的 `flow2spec.config.json`，不是插件自身的 Cordis `Config`。

表单已知字段与控件：

| 键路径 | 控件 | 取值 |
|---|---|---|
| `locale` | 下拉 | `zh-CN` / `en-US` |
| `subAgent` | 开关 | boolean |
| `switchAgentVerification` | 开关 | boolean |
| `intentRecognition` | 开关 | boolean |
| `changeTracking.feat` | 开关 | boolean |
| `changeTracking.fix` | 开关 | boolean |
| `changeTracking.implement` | 开关 | boolean |
| `updateCheck.enabled` | 开关 | boolean |
| `collaboration.enabled` | 开关 | boolean |
| `collaboration.developerId` | 文本 | 空串，或 sanitize 口径下的合法 id |

## 交付单元

### 配置读写模块 `src/card/config-io.ts`（新增）

纯 Node 侧逻辑，与 Cordis 解耦以便单测。

**导出**

```ts
export const CONFIG_FILENAME = 'flow2spec.config.json'

export interface ConfigReadResult {
  initialized: boolean
  config: Flow2SpecProjectConfig | undefined
  fingerprint: string
}

export type ConfigChange =
  | { path: readonly string[]; value: string | boolean }
  | { path: readonly string[]; remove: true }

export function readWorkspaceConfig(root: string): ConfigReadResult
export function saveWorkspaceConfig(input: {
  root: string
  fingerprint: string
  changes: readonly ConfigChange[]
}): { fingerprint: string; config: Flow2SpecProjectConfig }
export function validateChanges(changes: readonly ConfigChange[]): string | undefined
export function fingerprintOf(raw: string | undefined): string
```

**处理流程 — `readWorkspaceConfig`**

1. 拼 `join(root, CONFIG_FILENAME)`；不存在则返回 `{ initialized: false, config: undefined, fingerprint: '' }`。
2. 读原始文本，`fingerprintOf` 取 SHA-256 十六进制串。
3. `JSON.parse`；解析失败抛 `config-invalid`（文件被手工改坏时，卡片提示去修文件，不尝试自动修复）。
4. 返回 `{ initialized: true, config, fingerprint }`。

**处理流程 — `saveWorkspaceConfig`**

1. `validateChanges` 先校验（键路径在已知集合内、类型匹配、`developerId` 合规）；不通过抛 `config-invalid`。
2. 重新 `readWorkspaceConfig(root)`。
3. 比对指纹：与入参不一致抛 `config-conflict`。
4. 在解析出的对象上按 `path` 逐条赋值；`remove` 项删除该键。中间层级缺失时按需建对象。未涉及的键不动。
5. `JSON.stringify(config, null, 2) + '\n'` 写回。
6. 返回新指纹与写入后的配置。

**字段说明 — `validateChanges`**

| 校验 | 规则 |
|---|---|
| 键路径 | 必须命中「表单已知字段」表，拒绝任意路径写入 |
| 布尔字段 | 值必须是 `boolean` |
| `locale` | 值必须是 `zh-CN` 或 `en-US` |
| `collaboration.developerId` | 空串放行；否则必须满足 `/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/`，即 sanitize 后与原值相同 |

`developerId` 采取「校验而非静默改写」：用户输入 `Alice@corp.com` 时提示它会被规范成 `alice`，由用户决定，不替他做主。

### 卡片 RPC 端点 `src/card/settings-host.ts`（扩展）

签名变更：`registerSettingsCard(ctx: Context, runtime: Flow2SpecPluginRuntime): void`。`src/index.ts` 第 52 行同步改为 `registerSettingsCard(ctx, runtime)`。

在既有 `/flow2spec` 通道上新增三个端点，沿用现有的 `{ ok, value } | { ok, error }` 返回约定与 try/catch 兜底。

#### `card.config.read`

- **输入**：`{ cwd: string }`
- **输出**：`ConfigReadResult`
- **流程**：`resolveWorkspaceRoot` 不参与——工作区 `path` 即项目根，直接 `readWorkspaceConfig(cwd)`。

#### `card.config.save`

- **输入**：`{ cwd: string; fingerprint: string; changes: ConfigChange[] }`
- **输出**：`{ fingerprint: string; config: Flow2SpecProjectConfig }`
- **流程**：`saveWorkspaceConfig` → 成功后 `runtime.invalidate(cwd)` → 返回新指纹。抛出的 `config-conflict` / `config-invalid` 映射为对应 error code。

#### `card.project.init`

- **输入**：`{ cwd: string }`
- **输出**：`{ ids: string[] } & ConfigReadResult`
- **流程**：
  1. `readWorkspaceConfig(cwd)`，`initialized` 为 true 时返回 `already-initialized`（防重复点击与并发）。
  2. `createFlow2Spec({ cwd }).project.init({ mode: 'native-host', locale })`，`locale` 取插件 `runtime.configSnapshot().locale`，与 `/flow2spec init` 一致。
  3. `runtime.invalidate(cwd)`。
  4. 重新 `readWorkspaceConfig(cwd)`，把 `ids`（Core 报告的实际写入项）与配置一并返回。

初始化前的「将写入什么」由客户端按 `native-host` 模式的固定产物展示（`flow2spec.config.json`、`.Knowledge/`、`.dsh/`）；执行后以返回的 `ids` 展示实际结果。

### 卡片界面 `src/client/index.tsx`（扩展）

**Props 类型放宽**

现有 `useWorkspaces` 声明只能选出 `string | undefined`，需要泛化：

```ts
interface WorkspaceItem { workspaceId: string; path: string; title: string }
interface WorkspaceList { items: readonly WorkspaceItem[] }
interface CardProps {
  t: (key: string) => string
  rpc: ConnectionRpc
  useWorkspaces?: <T>(selector: (state: WorkspaceList) => T) => T
}
```

`emptyWorkspaces` 兜底同步泛化。原先 `const _ = cwd` 这行占位可以去掉——`cwd` 将真正参与渲染。

**结构**

```
<li> 卡片
  <button> 折叠头（不变）
  <div> body
    <dl> 版本区：插件版本 / Core 版本（不变）
    <div> 检查更新页脚（不变）
    <section> 工作区区（新增）
      搜索框（items.length > 5 时出现）
      工作区列表（单选）
      选中后：ConfigForm 或 未初始化面板
```

**新增组件**

| 组件 | 职责 |
|---|---|
| `WorkspaceSection` | 选中态、搜索过滤、按 `cwd` 拉 `card.config.read` |
| `WorkspacePicker` | 列表渲染与单选；每项显示 `title` + `path` |
| `ConfigForm` | 表单渲染、脏值收集、保存 / 放弃 |
| `InitPanel` | 未初始化态、确认清单、初始化按钮 |
| `ToggleRow` / `SelectRow` / `TextRow` | 表单控件行，沿用 `f2sPc-row` 视觉 |

**`ConfigForm` 状态与流程**

1. 收到 `ConfigReadResult` 后存 `loaded`（基线配置）与 `fingerprint`。
2. 用户改动写入 `draft`；`changes` 由 `draft` 与 `loaded` 逐键 diff 得出，只含真正不同的叶子。
3. `changes.length > 0` 时「保存」「放弃」可用，并显示「有未保存改动」。
4. 保存：置 `saving`，调 `card.config.save`；成功则用返回值刷新 `loaded` / `fingerprint` 并清空 `draft`。
5. 失败按 code 分支：
   - `config-conflict`：提示文件已被外部修改，给「重新加载」按钮，保留用户改动直到他点重新加载；
   - `config-invalid`：就地显示校验信息，不清空表单；
   - 其他：显示原始 message。
6. 切换工作区时若存在未保存改动，先弹确认。

**`developerId` 提示**：该行下方常驻一行说明——留空表示按 git 邮箱/用户名推断；值变化时追加提示已有的 `.task/<旧 id>/` 目录不会跟着改名。

**空态**：`items.length === 0` 时工作区区显示一行说明，引导去侧边栏添加工作区；版本区不受影响。

### 类型定义 `src/card/types.ts`（扩展）

新增 `ConfigReadResult`、`ConfigChange`、`ConfigSaveResult`、`ProjectInitCardResult`，并把 `CardRpcPayload` 由 `{ cwd?: string }` 扩为可携带 `fingerprint` 与 `changes` 的联合类型（宿主侧按 endpoint 分别做窄化校验，不信任客户端传入形状）。

`CardStatus.compatibility` 与 `projectBaseline` 保持原样：它们已不在卡片上渲染，但仍被 `/flow2spec status` 与测试使用，本次不动。

### 测试 `tests/card-config-io.spec.ts`（新增）

用临时目录覆盖：

- 读取不存在的文件 → `initialized: false`，指纹为空串。
- 读取正常文件 → 字段与指纹正确。
- 保存后未知字段仍在。
- 指纹不匹配 → 抛 `config-conflict`，且文件内容未变。
- 非法键路径、错误类型、非法 `developerId` → 抛 `config-invalid`。
- 保存后返回的新指纹等于重新读取的指纹。

## 调用流程

1. 用户展开卡片 → 版本区按现有逻辑加载；工作区区从 `useWorkspaces` 拿到列表，尚未选中。
2. 选中工作区 → `card.config.read` → 渲染表单或未初始化面板。
3. 编辑 → 本地 `draft`，不发请求。
4. 点保存 → `card.config.save` → 成功刷新基线；冲突则提示重新加载。
5. 未初始化时点初始化 → 展示确认清单 → `card.project.init` → 成功后直接进入步骤 2 的表单态。

## 错误码

宿主侧沿用既有 `{ code, message, details }` 结构。

| code | 说明 | 客户端处理 |
|---|---|---|
| `bad-request` | endpoint 未知，或 payload 形状不合法（缺 `cwd` 等） | 显示原始 message |
| `config-invalid` | 文件 JSON 解析失败，或改动未通过校验 | 就地提示，保留用户输入 |
| `config-conflict` | 保存时指纹与磁盘不一致 | 提示外部已修改，提供「重新加载」 |
| `already-initialized` | 对已初始化工作区调用 init | 刷新为表单态 |
| `internal` | 其余异常（IO、权限、Core 抛错） | 显示 message，允许重试 |

## 数据模型

```ts
// 宿主 → 卡片
interface ConfigReadResult {
  initialized: boolean
  config: Flow2SpecProjectConfig | undefined
  fingerprint: string          // SHA-256 hex；文件不存在时为 ''
}

interface ConfigSaveResult {
  fingerprint: string
  config: Flow2SpecProjectConfig
}

interface ProjectInitCardResult extends ConfigReadResult {
  ids: string[]                // Core 报告的实际写入项
}

// 卡片 → 宿主
type ConfigChange =
  | { path: readonly string[]; value: string | boolean }
  | { path: readonly string[]; remove: true }

interface ConfigSavePayload {
  cwd: string
  fingerprint: string
  changes: ConfigChange[]
}
```

`Flow2SpecProjectConfig` 直接复用 `@double-coding/flow2spec-core` 导出的同名类型（其索引签名 `[key: string]: unknown` 正好承载未知字段）。
