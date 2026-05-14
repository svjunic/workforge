# workforge

`workforge` は、AI コーディング作業を `git worktree` と `tmux` でタスク単位に分離して実行するローカル CLI です。

MVP では自動 merge は行わず、1タスクにつき 1ブランチ、1 worktree を作成し、AI の作業結果を `diff` で review 状態に進めるところまでを扱います。

## 必要なもの

- Node.js 20 以上
- git
- tmux
- 利用する AI adapter のコマンド
  - 既定: `claude`
  - 代替: `codex`
- fzf (任意)
  - `taskId` 省略時の選択 UI に使います。
  - 未インストールの場合は番号入力に fallback します。
- `VISUAL` または `EDITOR` (任意)
  - `wf create` で title を省略したときのエディタ入力に使います。

`tmux`、`claude`、`codex`、`fzf` は `workforge` ではインストールしません。使うものは事前に PATH から実行できる状態にしてください。エディタ入力を使う場合は `VISUAL` または `EDITOR` を設定してください。

## 開発用の実行

```bash
git clone <workforge-repo-url>
cd workforge
npm install
npm run dev -- --help
npm run dev -- create "ログイン画面を修正する"
```

## ローカル CLI として使う

```bash
npm run build
npm link

cd /path/to/target-git-repo
wf create "ログイン画面を修正する"
wf run [taskId]
```

## コマンド

### `wf create [title] [--description <text>]`

`main` から `workforge/<id>-<slug>` ブランチを作成し、`.workforge/worktrees/<id>` に worktree を作ります。タスク状態は `created` になります。

`title` を省略すると、`VISUAL` または `EDITOR` のエディタで Markdown テンプレートを開きます。編集後、最初の H1 をタスクタイトル、本文全体をタスク説明として保存します。title 省略時は `--description` を同時指定できません。

### `wf list [--all]`

タスク一覧を作成時刻の新しい順に表示します。既定では `deleted` のタスクを表示しません。`--all` を指定すると `deleted` を含むすべてのタスクを表示します。

### `wf status [taskId]`

タスク詳細と tmux の状態を表示します。`taskId` を省略した場合は簡易一覧を表示します。

### `wf run [taskId] [--agent claude|codex]`

選択した adapter をタスクの worktree で tmux 起動します。`taskId` を省略した場合は `fzf`、または番号入力で未削除タスクを選択します。tmux 内から実行した場合は現在の window 内に新しい pane を作成し、tmux 外から実行した場合は従来どおりタスク専用 session を作成します。`--agent` は `.workforge/config.json` の `defaultAgent` より優先されます。タスク状態は `running` になります。Claude adapter では `--permission-mode plan` を付けて起動します。

### `wf stop <taskId>`

対象タスクの tmux pane/session に `Ctrl-C` を送り、タスク状態を `stopped` にします。

### `wf resume <taskId>`

同じ worktree で adapter を再起動します。タスク状態は `running` になります。Claude adapter では `--permission-mode auto` を付けて起動します。Codex adapter には同等の mode 引数を付けません。

### `wf diff <taskId>`

タスク worktree の差分を表示し、`.workforge/diffs/<taskId>.patch` に保存します。タスク状態は `review` になります。

### `wf comment <taskId> <text>`

`.workforge/comments/<taskId>.jsonl` にコメントを追記します。

### `wf log <taskId>`

`.workforge/logs/<taskId>.log` に保存された tmux ログを表示します。

### `wf delete [taskId] [--force] [--all]`

タスク worktree を削除し、タスク状態を `deleted` にします。`taskId` を省略した場合は `fzf`、または番号入力で未削除タスクを選択します。`--all` は未削除タスクをすべて削除します。全削除前には確認プロンプトを表示します。worktree 削除に失敗した場合、意図した削除なら `--force` を付けて再実行します。

## `.workforge/config.json`

初回実行時に対象 git リポジトリ内へ以下の設定が作成されます。

```json
{
  "defaultAgent": "claude",
  "worktreeRoot": ".workforge/worktrees",
  "tmuxSessionPrefix": "workforge",
  "keepPaneOnDone": true,
  "tmuxPanePlacement": "rightColumnPairs"
}
```

`defaultAgent` は `claude` または `codex` を指定できます。

`tmuxPanePlacement` は `rightColumnPairs` または `default` を指定できます。`rightColumnPairs` は tmux 内で `run` / `resume` したとき、1枚目を右に作り、次をその下に作り、以後同じ流れを繰り返します。`default` は tmux の既定 split に任せます。tmux 外で実行して task 専用 session を作る場合、この設定は使いません。

## create テンプレート

初回実行時に `.workforge/create-template.md` が作成されます。`wf create` で title を省略したときは、このテンプレートをエディタで開きます。対象リポジトリごとに内容を変更できます。

## 作成されるファイル

対象 git リポジトリには `.workforge/` 配下だけを作成します。

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

## 制約

- `main` は直接変更しません。
- 1 task = 1 branch = 1 worktree です。
- AI プロセス終了後も、既定では tmux pane/session を残します。
- 停止したタスクは `resume` で再開します。
- 自動 merge は行いません。
- git リポジトリ外、初期コミットなし、`tmux` なし、adapter コマンドなし、設定不正は明確なエラーにします。

## 検証

```bash
npm run typecheck
npm run build
npm run dev -- --help
```
