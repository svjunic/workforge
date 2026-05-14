# aitask

`aitask` は、AI コーディング作業を `git worktree` と `tmux` でタスク単位に分離して実行するローカル CLI です。

MVP では自動 merge は行わず、1タスクにつき 1ブランチ、1 worktree を作成し、AI の作業結果を `diff` で review 状態に進めるところまでを扱います。

## 必要なもの

- Node.js 20 以上
- git
- tmux
- 利用する AI adapter のコマンド
  - 既定: `claude`
  - 代替: `codex`

`tmux`、`claude`、`codex` は `aitask` ではインストールしません。事前に PATH から実行できる状態にしてください。

## 開発用の実行

```bash
git clone <aitask-repo-url>
cd aitask
npm install
npm run dev -- --help
npm run dev -- create "ログイン画面を修正する"
```

## ローカル CLI として使う

```bash
npm run build
npm link

cd /path/to/target-git-repo
aitask create "ログイン画面を修正する"
aitask run <taskId>
```

## コマンド

### `aitask create <title> [--description <text>]`

`main` から `aitask/<id>-<slug>` ブランチを作成し、`.aitask/worktrees/<id>` に worktree を作ります。タスク状態は `created` になります。

### `aitask list`

タスク一覧を表示します。

### `aitask status [taskId]`

タスク詳細と tmux セッションの状態を表示します。`taskId` を省略した場合は簡易一覧を表示します。

### `aitask run <taskId> [--agent claude|codex]`

選択した adapter をタスクの worktree で tmux 起動します。`--agent` は `.aitask/config.json` の `defaultAgent` より優先されます。タスク状態は `running` になります。

### `aitask stop <taskId>`

対象タスクの tmux pane に `Ctrl-C` を送り、タスク状態を `stopped` にします。

### `aitask resume <taskId>`

同じ worktree で adapter を再起動します。タスク状態は `running` になります。

### `aitask diff <taskId>`

タスク worktree の差分を表示し、`.aitask/diffs/<taskId>.patch` に保存します。タスク状態は `review` になります。

### `aitask comment <taskId> <text>`

`.aitask/comments/<taskId>.jsonl` にコメントを追記します。

### `aitask log <taskId>`

`.aitask/logs/<taskId>.log` に保存された tmux ログを表示します。

### `aitask delete <taskId> [--force]`

タスク worktree を削除し、タスク状態を `deleted` にします。worktree 削除に失敗した場合、意図した削除なら `--force` を付けて再実行します。

## `.aitask/config.json`

初回実行時に対象 git リポジトリ内へ以下の設定が作成されます。

```json
{
  "defaultAgent": "claude",
  "worktreeRoot": ".aitask/worktrees",
  "tmuxSessionPrefix": "aitask",
  "keepPaneOnDone": true
}
```

`defaultAgent` は `claude` または `codex` を指定できます。

## 作成されるファイル

対象 git リポジトリには `.aitask/` 配下だけを作成します。

```text
.aitask/
  config.json
  tasks.json
  logs/
  comments/
  diffs/
  worktrees/
```

## 制約

- `main` は直接変更しません。
- 1 task = 1 branch = 1 worktree です。
- AI プロセス終了後も、既定では tmux pane を残します。
- 停止したタスクは `resume` で再開します。
- 自動 merge は行いません。
- git リポジトリ外、初期コミットなし、`tmux` なし、adapter コマンドなし、設定不正は明確なエラーにします。

## 検証

```bash
npm run typecheck
npm run build
npm run dev -- --help
```
