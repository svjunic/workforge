# workforge

语言: [English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

`workforge` 是一个本地 CLI，用 `git worktree` 和 `tmux` 按任务隔离 AI 编码工作。

WorkForge 目前仍在开发中，命令和配置可能会变化。

MVP 不会自动 merge。它为每个任务创建一个分支和一个 worktree，在其中运行 AI coding adapter，并通过保存和显示 `diff` 帮助你进入 review 状态。

## WorkForge 让什么更轻松

- 将 AI 修改隔离在每个任务专属的 git worktree 中。
- 用 `wf run --agent ...` 切换 AI adapter，减少记忆各工具启动参数的负担。
- 通过 tmux pane/session 和 `.workforge/logs/` 中的日志追踪运行中的任务。
- 用 `wf diff` 先 review 任务产出，再决定是否 commit 或 merge。
- 更容易保持 main worktree 不被直接修改。

## 依赖

- Node.js 20 或更高版本
- git
- tmux
- 要使用的 AI adapter 命令
  - 默认: `claude`
  - 可选: `codex`、`aider`、`copilot`
- fzf (可选)
  - 省略 `taskId` 时用于选择任务。
  - 未安装时会 fallback 到编号输入。
- `VISUAL` 或 `EDITOR` (可选)
  - `wf create` 省略 title 时用于编辑器输入。

`workforge` 不会安装 `tmux`、`claude`、`codex`、`aider`、`copilot` 或 `fzf`。请提前安装要使用的命令，并确保它们在 `PATH` 中。如果要使用编辑器创建任务，请设置 `VISUAL` 或 `EDITOR`。

## 安装

```bash
npm install -g github:svjunic/workforge
wf --help

cd /path/to/target-git-repo
wf init
wf create "修复登录页面"
wf run [taskId]
```

这会安装已提交的 CLI bundle，并让 `wf` 命令在全局可用。

## 开发运行

如果你要修改 WorkForge 本身，请使用这个流程。

```bash
git clone https://github.com/svjunic/workforge.git
cd workforge
npm ci
npm run dev -- --help
npm run dev -- init
npm run dev -- create "修复登录页面"
```

使用 `npm ci` 按 `package-lock.json` 精确安装依赖。

如果想通过真实的 `wf` 命令测试本地 checkout，可以把它 link 到全局。

```bash
npm run build
npm link
wf --help
```

修改源码后，请重新运行 `npm run build`，这样已 link 的 `wf` 命令才会使用最新的 `dist/cli.js`。不再需要 link 时，可以运行 `npm unlink -g workforge`。

## 工作流示例

```bash
wf create "Fix login validation"
wf run <taskId> --agent claude
```

WorkForge 会从 `main` 创建类似 `workforge/<id>-<slug>` 的分支，在 `.workforge/worktrees/<id>` 下添加 worktree，并在 tmux 中启动选定的 adapter。

任务运行时，可以查看状态和日志，也可以停止或恢复任务。

```bash
wf status <taskId>
wf log <taskId>
wf stop <taskId>
wf resume <taskId>
```

adapter 完成后，查看变更。

```bash
wf diff <taskId>
```

之后使用你平时的 git workflow 进行检查、测试、commit 和 merge。不再需要任务 worktree 时，将其删除。

```bash
wf delete <taskId>
```

## 命令

### `wf init`

以交互方式创建 `.workforge/config.json`。WorkForge 会按顺序询问每个配置项，并在最后一个回答后写入 config。使用其他命令前，请在每个目标 git 仓库中先运行一次。

### `wf create [title] [--description <text>]`

从 `main` 创建 `workforge/<id>-<slug>` 分支，并在 `.workforge/worktrees/<id>` 创建 worktree。任务状态会变为 `created`。

省略 `title` 时，WorkForge 会用 `VISUAL` 或 `EDITOR` 打开 Markdown 模板。编辑完成后，第一个 H1 会成为任务标题，正文整体会成为任务描述。省略 title 时不能同时使用 `--description`。

### `wf list [--all]`

按创建时间倒序显示任务列表。默认不显示 `deleted` 任务。使用 `--all` 可显示包括 deleted 在内的全部任务。

### `wf status [taskId]`

显示任务详情和 tmux 状态。省略 `taskId` 时显示简洁任务列表。

### `wf run [taskId] [--agent claude|codex|aider|copilot]`

在任务 worktree 中用 tmux 启动选定的 adapter。省略 `taskId` 时，WorkForge 会用 `fzf` 或编号输入选择未删除任务。从 tmux 内运行时，会在当前 window 中创建新 pane。从 tmux 外运行时，会创建任务专用 session。`--agent` 优先于 `.workforge/config.json` 中的 `defaultAgent`。任务状态会变为 `running`。

各 agent 的启动行为:

- Claude: 使用 `--permission-mode plan` 启动。
- Aider: 使用 `--architect` 以 architect mode 启动。
- Copilot: 使用 `--mode plan -i` 以 GitHub Copilot CLI 的 plan mode 交互启动。
- Codex: 不添加额外 mode 参数。

WorkForge 会在任务标题和描述之外追加自己的指令，然后再把合成后的 prompt 传给各 adapter: 只在当前 git worktree 中工作，不要修改 main worktree，并完成从实现到验证的全过程。

### `wf stop <taskId>`

向任务的 tmux pane/session 发送 `Ctrl-C`，并将任务状态设为 `stopped`。

### `wf resume <taskId>`

在同一个 worktree 中重新启动 adapter，并将任务状态设为 `running`。Claude 使用 `--permission-mode auto`。Aider 再次使用 `--architect`。Copilot 再次使用 `--mode plan -i`。Codex 不添加额外 mode 参数。

### `wf diff <taskId>`

显示任务 worktree 的 diff，并保存到 `.workforge/diffs/<taskId>.patch`。任务状态会变为 `review`。

### `wf comment <taskId> <text>`

向 `.workforge/comments/<taskId>.jsonl` 追加评论。

### `wf log <taskId>`

输出 `.workforge/logs/<taskId>.log` 中保存的 tmux 日志。

### `wf delete [taskId] [--force] [--all]`

删除任务 worktree，并将任务状态设为 `deleted`。省略 `taskId` 时，WorkForge 会用 `fzf` 或编号输入选择未删除任务。`--all` 会在确认后删除所有未删除任务。如果 `git worktree remove` 失败且你确认要删除，请加上 `--force` 重新执行。

## `.workforge/config.json`

`wf init` 会在目标 git 仓库中创建以下配置。

```json
{
  "defaultAgent": "claude",
  "worktreeRoot": ".workforge/worktrees",
  "tmuxSessionPrefix": "workforge",
  "keepPaneOnDone": true,
  "tmuxPanePlacement": "rightColumnPairs"
}
```

`defaultAgent` 可以是 `claude`、`codex`、`aider` 或 `copilot`。

`tmuxPanePlacement` 可以是 `rightColumnPairs` 或 `default`。`rightColumnPairs` 在 tmux 内执行 `run` / `resume` 时，会先在右侧创建 pane，再在其下方创建下一个 pane，并重复这个模式。`default` 交给 tmux 默认 split 行为处理。从 tmux 外创建任务专用 session 时，不使用此设置。

## create 模板

`wf init` 会创建 `.workforge/create-template.md`。当 `wf create` 不传 title 时，WorkForge 会在编辑器中打开这个模板。你可以针对每个目标仓库自定义它。

## 创建的文件

WorkForge 只会在目标 git 仓库的 `.workforge/` 下创建文件。

```text
.workforge/
  config.json
  create-template.md
  tmux-layout.json
  tasks.json
  logs/
  comments/
  diffs/
  worktrees/
```

## 限制

- WorkForge 不会直接修改 `main`。
- 一个 task 对应一个 branch 和一个 worktree。
- AI 进程结束后，默认保留 tmux pane/session。
- 停止的任务用 `resume` 重新启动。
- WorkForge 不会自动 merge。
- 在 git 仓库外运行、没有初始 commit、缺少 `tmux`、缺少 adapter 命令或配置无效时，会给出明确错误。

## 验证

```bash
npm run typecheck
npm run build
npm run dev -- --help
```
