# dsh-stop-that-shit

> **Unofficial.** This is a third-party DeepSeek Harness adapter for
> [Stop That Shit](https://github.com/lennney/stop-that-shit) (MIT), not an
> official release of that project. The judgment engine is vendored unchanged
> except for the one patch listed in [VENDOR.md](VENDOR.md).

把 Stop That Shit 的判定引擎接到 DSH 上：两个 Skill、一个 `/sts` 命令、每次工具调用前的契约检查（deny / ask / pass）。

- 未武装的会话**全部放行**，只有用户显式写下契约才生效；
- 契约按**根会话**记账，子会话、孙会话都按根的契约判定；
- 拒绝是真正的工具拒绝（模型看到 `Error: STOP / …`），不是提示词劝阻；
- 依赖安装可以映射成 DSH 的审批卡（`ask`），而不是直接拒绝。

## 功能

| 能力 | 说明 |
|---|---|
| Skills | `stop-that-shit`、`stss` 通过 `ctx.skills.register()` 进入模型技能目录 |
| `/sts` | `ctx.commands.register()` 注册，执行不产生模型消息；可只武装，也可武装后转发任务 |
| Guard | `tools/pre-execute` 返回 `deny` / `ask` / 放行 |
| 审计 | 每次拒绝写入 `~/.dsh/stop-that-shit/audit/*.jsonl`，Runtime 命令可查 |
| 委派预算 | `agents=N` 按根会话记账，`subagent` / `subagent_fork` / `workflow` / `ralph` 都计入 |

## 安装

**推荐**：Web 侧边栏 → 插件 → 安装本地目录，或 `plugin_manager` 工具：

```
action: install_bundle
target: <absolute path to this directory>
```

已安装 dsh CLI 时也可以：

```powershell
dsh plugin --profile desktop add github:hua2003-liu/dsh-stop-that-shit
```

安装后重启或等 HMR 重新组合；替换已安装的包需要重启进程。

## 使用

```text
/sts review -- Review this diff, report problems, change nothing.
/sts change files=src/config.cjs|test/config.test.cjs -- Fix the config read.
/sts change deps=allow hash=allow -- Add the parser I asked for.
/sts status
```

也可以继续用上游的 prompt 指令（必须是消息第一个非空行）：

```text
$stop-that-shit change files=src/** -- implement the parser
```

| 字段 | 取值 | 默认 |
|---|---|---|
| mode | `answer` `review` `monitor` `change` `watch` | `unconfirmed` |
| level | `watch` `guard` `lock` `off` | `watch` |
| `files=` | `a/**\|b`，`**` 表示全树 | 不设边界 |
| `deps=` | `allow` `ask` `deny` | `ask` |
| `hash=` | `allow` `ask` `deny` | `deny` |
| `agents=` | 非负整数 | 不限 |

`--` 之后是任务正文；正文里不要再写指令。

## 事件映射

| DSH | 用途 |
|---|---|
| `agent/pre-step` | 从可信用户消息里解析指令，把契约摘要作为非用户来源的上下文附在本步 |
| `tools/pre-execute` | 判定每次调用：`deny` / `ask` / `next()` |
| `tools/post-execute` | 观察结算结果，更新委派账本 |
| `session/created|disposed` | 初始化 / 结束会话状态 |
| `subagent/start|end` | 委派预留与释放 |

root lineage：`header.parentSession` 只有直接父，插件会一路走到无父会话；走不到就 fail-closed 拒绝，不拿中间子会话当根。

## 状态

```
~/.dsh/stop-that-shit/sessions/<hash>.json
~/.dsh/stop-that-shit/audit/<hash>.jsonl
```

`dataDir` 可在 patch 的 config 里覆盖。删除目录即重置所有契约。

## 已知限制

- **不是安全边界**。真正的隔离是 DSH 的 fs sandbox / 权限预设；这是任务边界护栏。
- **`run_code`（PTC）**：程序体可以直接 `import('node:fs')` 写文件，只有嵌套的 `tools.*` 调用会被逐个判定。默认把 `run_code` 记为 `unknown` 走审批；只有能证明运行时被约束时才设 `runCodeBindingOnly: true`。
- **shell 写目标未证明**：`mkdir src/x`、`echo > src/x` 这类命令在 `files=` 边界下仍可能被判 `WRITE_PATH_UNPROVEN`（要求审批）。上游 0.2.5.1 的修复尚未合入本仓库的 vendor。
- **审批的审计标签**：`ask` 在 audit 里仍记成 denial response（controller 的响应枚举没有 approval 值）。
- **尚未在真实 DSH 会话验证**：`npm test` 的 10 项断言跑在进程内 fake ctx + 真实 vendored adapter 上；没有启动 Harness 做过端到端。安装后请先用 `/sts review` 试一次越界写。

## 开发

```powershell
npm test          # node test/plugin.test.cjs
npm run check     # node --check
npm run update-vendor
```

## 许可

本仓库的胶水代码 MIT；`vendor/` 与 `skills/` 来自上游 MIT，见 [NOTICE.md](NOTICE.md) 与 [vendor/UPSTREAM-LICENSE](vendor/UPSTREAM-LICENSE)。

上游：<https://github.com/lennney/stop-that-shit>
