# workforge

Languages: [English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

`workforge` is a local CLI that isolates AI coding work by task using `git worktree` and `tmux`.

WorkForge is currently under active development, so commands and config may change.

The MVP does not automatically merge changes. It creates one branch and one worktree per task, runs an AI coding adapter there, and helps you move the task into review by saving and showing its `diff`.

## What WorkForge Makes Easier

- Keep AI edits isolated in a dedicated git worktree for each task.
- Switch between AI adapters with `wf run --agent ...` instead of remembering each tool's startup flags.
- Track running work through tmux panes or sessions, with logs saved under `.workforge/logs/`.
- Review the task output with `wf diff` before deciding what to commit or merge.
- Avoid accidental edits to your main worktree by giving every task its own branch and workspace.

## Requirements

- Node.js 20 or newer
- git
- tmux
- The AI adapter command you want to use
  - Default: `claude`
  - Alternatives: `codex`, `aider`, `copilot`
- fzf (optional)
  - Used for task selection when `taskId` is omitted.
  - Falls back to numbered input when unavailable.
- `VISUAL` or `EDITOR` (optional)
  - Used only when `wf create` is run without a title.
  - `VISUAL` takes priority over `EDITOR`.
  - Set it to an editor command available on `PATH`, such as `vim`, `nano`, or `code`.

`workforge` does not install `tmux`, `claude`, `codex`, `aider`, `copilot`, or `fzf`. Install the commands you want to use and make sure they are available on `PATH`. Set `VISUAL` or `EDITOR` if you want to create tasks by editing a Markdown template:

```bash
export VISUAL=vim
wf create
```

## Install

```bash
npm install -g github:svjunic/workforge
wf --help

cd /path/to/target-git-repo
wf init
wf create "Fix the login screen"
wf run [taskId]
```

This installs the committed CLI bundle and makes the `wf` command available globally.

## Development

Use this flow when you want to modify WorkForge itself.

```bash
git clone https://github.com/svjunic/workforge.git
cd workforge
npm ci
npm run dev -- --help
npm run dev -- init
npm run dev -- create "Fix the login screen"
```

Use `npm ci` to install exactly what is recorded in `package-lock.json`.

To test the local checkout through the real `wf` command, link it globally:

```bash
npm run build
npm link
wf --help
```

After changing source files, run `npm run build` again so the linked `wf` command uses the latest `dist/cli.js`. When you no longer need the link, run `npm unlink -g workforge`.

## Example Workflow

```bash
wf create "Fix login validation"
wf run <taskId> --agent claude
```

WorkForge creates a branch like `workforge/<id>-<slug>` from `main`, adds a worktree under `.workforge/worktrees/<id>`, and starts the selected adapter in tmux.

While the task is running:

```bash
wf status <taskId>
wf log <taskId>
wf stop <taskId>
wf resume <taskId>
```

When the adapter finishes, review the changes:

```bash
wf diff <taskId>
```

Then inspect, test, commit, and merge using your normal git workflow. When you no longer need the task worktree:

```bash
wf delete <taskId>
```

## Commands

### `wf init`

Creates `.workforge/config.json` interactively. WorkForge asks for each setting in order and writes the config after the final answer. Run this once in each target git repository before using other commands.

### `wf create [title] [--description <text>]`

Creates a `workforge/<id>-<slug>` branch from `main` and adds a worktree at `.workforge/worktrees/<id>`. The task status becomes `created`.

When `title` is omitted, WorkForge opens `.workforge/create-template.md` in the editor configured by `VISUAL` or `EDITOR`. `VISUAL` takes priority; if neither variable is set, the command fails with an error. After editing, the first Markdown H1 becomes the task title and the full body becomes the task description. `--description` cannot be used when the title is omitted. When `title` is provided on the command line, no editor is opened.

### `wf list [--all]`

Lists tasks by creation time, newest first. Deleted tasks are hidden by default. Use `--all` to include deleted tasks.

### `wf status [taskId]`

Shows task details and tmux status. When `taskId` is omitted, shows a compact task list.

### `wf run [taskId] [--agent claude|codex|aider|copilot]`

Starts the selected adapter in tmux inside the task worktree. When `taskId` is omitted, WorkForge uses `fzf` or numbered input to select a non-deleted task; the `fzf` candidate list is shown at the top of the screen. When run from inside tmux, WorkForge creates a new pane in the current window. When run outside tmux, it creates a dedicated task session. `--agent` overrides `defaultAgent` in `.workforge/config.json`. The task status becomes `running`.

Agent-specific startup behavior:

- Claude: starts with `--permission-mode plan`.
- Aider: starts with `--architect` in architect mode.
- Copilot: starts GitHub Copilot CLI with `--mode plan -i`.
- Codex: starts without extra mode flags.

WorkForge appends its own instructions to the task title and description before sending the prompt to each adapter: work only inside this git worktree, do not modify the main worktree, and complete implementation through verification.

### `wf stop [taskId]`

Sends `Ctrl-C` to the task tmux pane or session and sets the task status to `stopped`. When `taskId` is omitted, WorkForge uses `fzf` or numbered input to select a non-deleted task.

### `wf resume [taskId]`

Restarts the adapter in the same worktree and sets the task status to `running`. When `taskId` is omitted, WorkForge uses `fzf` or numbered input to select a non-deleted task. Claude starts with `--permission-mode auto`. Aider starts with `--architect` again. Copilot starts with `--mode plan -i` again. Codex starts without extra mode flags.

### `wf diff [taskId]`

Shows the task worktree diff and saves it to `.workforge/diffs/<taskId>.patch`. When `taskId` is omitted, WorkForge uses `fzf` or numbered input to select a non-deleted task. The task status becomes `review`.

### `wf comment [taskId] [text] [--text <text>]`

Appends a comment to `.workforge/comments/<taskId>.jsonl`. The existing `wf comment <taskId> <text>` form is supported. To select the task interactively, omit `taskId` and pass the comment with `--text`.

### `wf log [taskId]`

Prints the saved tmux log from `.workforge/logs/<taskId>.log`. When `taskId` is omitted, WorkForge uses `fzf` or numbered input to select a non-deleted task.

### `wf delete [taskId] [--force] [--all]`

Removes a task worktree and sets the task status to `deleted`. When `taskId` is omitted, WorkForge uses `fzf` or numbered input to select a non-deleted task; the `fzf` candidate list is shown at the top of the screen. `--all` deletes every non-deleted task after a confirmation prompt. If `git worktree remove` fails and the removal is intentional, rerun with `--force`.

## `.workforge/config.json`

`wf init` creates this config in the target git repository:

```json
{
  "defaultAgent": "claude",
  "worktreeRoot": ".workforge/worktrees",
  "tmuxSessionPrefix": "workforge",
  "keepPaneOnDone": true,
  "tmuxPanePlacement": "rightColumnPairs",
  "tmuxShellMode": "loginInteractive"
}
```

`defaultAgent` can be `claude`, `codex`, `aider`, or `copilot`.

`tmuxPanePlacement` can be `rightColumnPairs` or `default`. `rightColumnPairs` creates the first pane on the right, the next one below it, and repeats that pattern when `run` or `resume` is invoked from inside tmux. `default` leaves splitting to tmux defaults. This setting is not used when WorkForge creates a dedicated task session outside tmux.

`tmuxShellMode` can be `loginInteractive` or `direct`. `loginInteractive` starts the adapter through `$SHELL -lic`, so shell startup files can set PATH for tools such as Node.js, nvm, asdf, or mise. `direct` keeps the previous behavior and passes the adapter command directly to tmux.

## Create Template

`wf init` creates `.workforge/create-template.md`. When `wf create` is called without a title, WorkForge opens this template in your editor. You can customize it per target repository.

## Created Files

WorkForge only creates files under `.workforge/` in the target git repository.

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

## Constraints

- WorkForge does not modify `main` directly.
- One task equals one branch and one worktree.
- By default, tmux panes or sessions remain after the AI process exits.
- Stopped tasks are restarted with `resume`.
- WorkForge does not automatically merge changes.
- Running outside a git repository, missing an initial commit, missing `tmux`, missing an adapter command, or invalid config produces a clear error.

## Verification

```bash
npm run typecheck
npm run build
npm run dev -- --help
```
