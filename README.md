# dsh-stop-that-shit

[![ci](https://github.com/hua2003-liu/dsh-stop-that-shit/actions/workflows/ci.yml/badge.svg)](https://github.com/hua2003-liu/dsh-stop-that-shit/actions/workflows/ci.yml)

把 [Stop That Shit](https://github.com/lennney/stop-that-shit) 的判定引擎接进 DeepSeek Harness：
两个 Skill、一个 `/sts` 命令、以及每次工具调用前的契约检查（`deny` / `ask` / 放行）。

> **非官方。** 这是第三方 DSH 适配层，不是上游项目的官方发行版。判定引擎（`vendor/`）与
> `skills/` 原样取自上游（MIT），本地改动只有 [VENDOR.md](VENDOR.md) 记录的那一处。

## 它做什么

- **未武装的会话全部放行**。只有你显式写下契约，检查才开始生效。
- **契约按根会话记账**：子会话、孙会话都按根的契约判定，不会因为委派而跳出边界。
- **拒绝是真正的工具拒绝**：模型拿到 `Error: STOP / …`，不是你跟它商量。
- **依赖安装可以变成审批卡**（`deps=ask`），而不是一刀切拒绝。

| 能力 | 实现 |
|---|---|
| Skills | `stop-that-shit`、`stss` 经 `ctx.skills.register()` 进入技能目录 |
| `/sts` | `ctx.commands.register()`；只武装，或武装后转发任务 |
| Guard | `tools/pre-execute` 返回 `deny` / `ask` / 放行 |
| 审计 | 每次判定写 `~/.dsh/stop-that-shit/runtime/<hash>.jsonl` |
| 委派预算 | `agents=N` 按根会话记账，`subagent` / `subagent_fork` / `workflow` 都计入 |

## 快速开始

要求：DSH Desktop（或 `dsh` CLI）`>= 0.2.1-rc.2`，Node `>= 22`。装完**开新会话**生效。

**A. 插件页（推荐）** — 侧边栏 → 插件 → 安装，填：

```
github:hua2003-liu/dsh-stop-that-shit
```

**B. CLI 一行**：

```powershell
dsh plugin --profile <profile> add github:hua2003-liu/dsh-stop-that-shit
```

`dsh plugin add` 会把依赖写进 profile 并**同时启用 bundle**（已验证）。用别的 profile 测试时，
`<profile>` 换成名字即可；`desktop` 归 Desktop 应用管理，装它请走插件页或 `plugin_manager`。

**C. 本地目录**（开发时）：

```powershell
dsh plugin --profile <profile> add C:\path\to\dsh-stop-that-shit
```

### 30 秒验证装好了

```powershell
# 技能是否进了目录：应该能看到 stop-that-shit 和 stss
dsh --profile <profile> headless 'List the exact names of every skill in your skill catalog, one per line.'

# 只读契约是否可以真的挡住写
dsh --profile <profile> headless '$stop-that-shit review -- deliberately try to create proof.txt, then report the denial text'
```

第二条应当报 `STOP / INTENT` + `MODE_FORBIDS_MUTATION`，并且 `proof.txt` 不存在。

## 用法

```text
/sts review -- Read this diff, report problems, change nothing.
/sts change files=src/** -- Add the parser.
/sts change deps=ask hash=allow -- Add the dependency I just asked for.
/sts status
```

也可以继续用上游的 prompt 指令，**必须是消息的第一个非空行**：

```text
$stop-that-shit change files=src/** -- implement the parser
```

| 字段 | 取值 | 默认 |
|---|---|---|
| mode | `answer` `review` `monitor` `change` `watch` | `unconfirmed`（只走 Stop Ladder，不构成完整契约） |
| level | `watch` `guard` `lock` `off` | `watch` |
| `files=` | `a/**\|b`，`**` 表示全树 | 不限边界 |
| `deps=` | `allow` `ask` `deny` | `ask` |
| `hash=` | `allow` `ask` `deny` | `deny` |
| `agents=` | 非负整数 | 不限 |

`--` 之后是任务正文；正文里不要再写指令。

### 判定结果

| 契约状态 | 工具调用 | 模型看到 |
|---|---|---|
| 未武装 | 全部放行 | 无异常 |
| `review` 里的写 | `deny` | `Error: STOP / INTENT` + `MODE_FORBIDS_MUTATION` |
| `files=` 之外 | `deny` | `Error: STOP / SCOPE` + `PATH_OUTSIDE_CONTRACT` |
| `deps=deny` 的安装 | `deny` | `Error: STOP / SCOPE` + `DEPENDENCY_NOT_AUTHORIZED` |
| `deps=ask` 的安装 | `ask` | 弹出 DSH 审批卡；无人可批时按拒绝处理 |
| 根会话不可达 | `deny`（fail-closed） | 要求先解析完整 lineage |

## 事件映射

| DSH 事件 | 用途 |
|---|---|
| `agent/pre-step` | 从可信用户消息里解析指令，并把契约摘要折进本步消息 |
| `tools/pre-execute` | 判定每次调用：`deny` / `ask` / `next()` |
| `tools/post-execute` | 观察结算结果，更新委派账本 |
| `session/created` / `session/disposed` | 初始化 / 结束会话状态 |
| `subagent/start` / `subagent/end` | 委派预留与释放 |

root lineage：`header.parentSession` 只给直接父；插件一路回溯到无父会话，回溯不了就 fail-closed 拒绝，
不拿中间子会话冒充根。

## 状态与审计

```
~/.dsh/stop-that-shit/sessions/<hash>.json   # 每个会话的契约与委派账本
~/.dsh/stop-that-shit/runtime/<hash>.jsonl   # 每次判定的事件流（JSONL）
```

`<hash>` 是根会话 id 的短哈希。删掉这个目录即重置全部契约。`dataDir` 可以在 patch 的 `config` 里覆盖。

## 配置

```yaml
# profile 的 cordis.patch.yml
- id: sts
  config:
    dataDir: ''              # 默认 ~/.dsh/stop-that-shit
    runCodeBindingOnly: false # 见「已知限制」
```

## 已知限制

- **不是安全边界**。真正的隔离是 DSH 的 fs sandbox / 权限预设；这里是任务边界护栏。
- **`run_code`（PTC）**：程序体可以直接 `import('node:fs')` 写文件，只有嵌套的 `tools.*`
  调用会被逐个判定。默认把 `run_code` 记为 `unknown` 走审批；只有能证明运行时被约束时
  才把 `runCodeBindingOnly` 设为 `true`。
- **shell 写目标未证明**：`mkdir src/x`、`echo > src/x` 这类命令在 `files=` 边界下可能被判
  `WRITE_PATH_UNPROVEN`（要求审批）。上游的 shell 写目标修复尚未合入本仓库的 vendor。
- **审计里的 `ask`**：记成 denial response（controller 的响应枚举没有 approval 值）。
- **审批卡依赖宿主**：headless 这类没有审批通道的宿主会把 `ask` 降级为拒绝，这是 DSH 的既定行为。

## 排障

| 现象 | 检查 |
|---|---|
| 新会话看不到 skill | 确认 bundle 已启用：`dsh --profile <p> --dump-config` 里应有 `id: sts` |
| 装了但没生效 | 新装 bundle 走 HMR 会即时激活；**替换已装的包**需要重启进程 |
| `dsh plugin add` 报 `EPERM ... rename` | profile 的 `node_modules` 里残留了旧链接；删掉该目录后重试 |
| 审批卡不弹 | 宿主没有审批通道，或 `deps=` 不是 `ask`；用 `/sts status` 看当前契约 |
| 拒绝原因是 `WRITE_PATH_UNPROVEN` | shell 命令的写目标无法证明，改用 `write`/`edit` 工具或放宽边界 |

## 开发

```powershell
npm test          # node test/plugin.test.cjs（10 项断言）
npm run check     # 语法检查
npm run update-vendor
```

## 许可

本仓库的胶水代码 MIT。`vendor/` 与 `skills/` 来自上游 MIT，见 [NOTICE.md](NOTICE.md) 与
[vendor/UPSTREAM-LICENSE](vendor/UPSTREAM-LICENSE)。

上游：<https://github.com/lennney/stop-that-shit>
