# Flow2Spec for DeepSeek Harness

给 DeepSeek Harness 用的 Flow2Spec 插件。装上之后，对话会按当前项目的知识库和规则来走。

同一个仓库里，Cursor、Claude、Codex 也能继续用这套 `.Knowledge/`，不用再配一份。

<p align="center">
  <a href="https://www.npmjs.com/package/@double-coding/flow2spec-deepseek-harness"><img src="https://img.shields.io/npm/v/%40double-coding%2Fflow2spec-deepseek-harness?logo=npm&label=npm" alt="npm version"></a>
  <a href="https://github.com/double-coding-lab/Flow2Spec-DeepSeek-Harness/actions/workflows/ci.yml"><img src="https://github.com/double-coding-lab/Flow2Spec-DeepSeek-Harness/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-0.1.0--rc.7-202c2c" alt="DeepSeek Harness 0.1.0-rc.7">
  <img src="https://img.shields.io/badge/Node.js-22.19%2B%20%7C%2024%2B-43853d" alt="Node.js 22.19 or newer">
</p>

<p align="center">
  <img src="./assets/readme/workflow.svg" width="100%" alt="Flow2Spec 在对话开始前按项目知识库做路由">
</p>

> DeepSeek Harness 目前还是开发者预览。这版插件 `1.2.0` 在 `@deepseek-ai/dsh@0.1.0-rc.7` 上验证过。

## 安装

需要 Node.js `^22.19.0` 或 `>=24`。

把插件装进要用的 profile，Web 一般是 `web`：

```bash
dsh plugin --profile web add @double-coding/flow2spec-deepseek-harness
```

然后启动：

```bash
dsh web
```

打开一个项目、开一场对话，插件会补上 `flow2spec.config.json` 和 `.Knowledge/`（已经有的不会覆盖）。之后在「设置 → 插件配置」里能看到 Flow2Spec 卡片：看版本、检查更新，并按工作区编辑项目配置。

## 用起来会看到什么

- 命令面板里有 `/flow2spec`，以及一串 `f2s-*` 技能
- 对话会按项目知识库选题，而不是每次全仓乱翻
- 设置页能看当前插件 / Core 版本，检查有没有新版本（只提示，不会替你安装），也能选中一个工作区改它的 `flow2spec.config.json`

## 命令

| 命令 | 作用 |
| --- | --- |
| `/flow2spec` / `status` | 看当前项目状态 |
| `/flow2spec init` | 手动给当前项目补齐配置和知识库目录 |
| `/flow2spec doctor` | 体检 |
| `/flow2spec route <一句话>` | 看这句话会命中哪个知识主题 |
| `/flow2spec kb check` | 校验知识库 |
| `/flow2spec kb build` | 重建知识路由后再校验 |
| `/flow2spec update` | 检查更新 |

## 项目配置

真正要改的是**项目根**的 `flow2spec.config.json`，不是 Harness 插件清单。新项目第一次对话后会自动生成，大致是这样：

```json
{
  "locale": "zh-CN",
  "subAgent": true,
  "switchAgentVerification": true,
  "intentRecognition": true,
  "changeTracking": {
    "feat": true,
    "fix": false,
    "implement": true
  },
  "updateCheck": {
    "enabled": true
  },
  "collaboration": {
    "enabled": true,
    "developerId": ""
  }
}
```

| 字段 | 作用 |
| --- | --- |
| `locale` | 技能和规则用中文还是英文 |
| `subAgent` | 技能是否允许拆成子任务 |
| `switchAgentVerification` | 落盘后要不要交叉校验 |
| `intentRecognition` | 是否根据对话自动进入对应 `f2s-*` 技能 |
| `changeTracking.*` | 哪些流程要写 `.task/` 任务清单 |
| `updateCheck.enabled` | 是否检查知识库模板有没有新版本 |
| `collaboration.enabled` | 多人协作时是否按人拆分 `.task/<id>/` |
| `collaboration.developerId` | 任务目录名；留空则用 git 用户名/邮箱 |

改这份文件即可，保存后下次技能执行时生效。也可以在「设置 → 插件配置」的 Flow2Spec 卡片里，按工作区搜索并编辑同一份文件。

## 已经在用 Flow2Spec 的项目

直接装插件就行，原来的 `.Knowledge/` 和配置会接着用。

如果项目里还有自己拷过的 `.dsh/skills/f2s-*`，会优先用那一份。`/flow2spec doctor` 会标出来，插件不会擅自删。核对完再自己决定要不要去掉。

## 开发

和 Flow2Spec 主仓一起改时，先装本地 Core，再跑检查：

```bash
npm install --no-save --package-lock=false ../Flow2Spec/packages/core
npm run check
npm run pack:install
```

## 兼容

| 插件 | Flow2Spec Core | DeepSeek Harness | Node.js |
| --- | --- | --- | --- |
| `1.2.0` | `3.4.x` | `0.1.0-rc.7` | `22.19+` / `24+` |

## License

ISC
