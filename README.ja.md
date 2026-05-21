# workforge

言語: [English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

`workforge` は、AI コーディング作業を `git worktree` と `tmux` でタスク単位に分離して実行するローカル CLI です。

WorkForge は現在開発中のため、コマンドや設定は変更される可能性があります。

MVP では自動 merge は行わず、1タスクにつき 1ブランチ、1 worktree を作成し、AI の作業結果を `diff` で review 状態に進めるところまでを扱います。

## 何が楽になるか

- AI の編集をタスクごとの専用 git worktree に隔離できます。
- `wf run --agent ...` で agent を切り替えられるため、各ツール固有の起動オプションを覚える必要が減ります。
- tmux pane/session と `.workforge/logs/` のログで、実行中の作業を追跡しやすくなります。
- `wf diff` でタスクの出力を確認してから、commit や merge に進められます。
- main の worktree を直接触らない運用にしやすくなります。

## 必要なもの

- Node.js 20 以上
- git
- tmux
- 利用する AI adapter のコマンド
  - 既定: `claude`
  - 代替: `codex`、`aider`、`copilot`
- fzf (任意)
  - `taskId` 省略時の選択 UI に使います。
  - 未インストールの場合は番号入力に fallback します。
- `VISUAL` または `EDITOR` (任意)
  - `wf create` で title を省略したときのエディタ入力に使います。

`tmux`、`claude`、`codex`、`aider`、`copilot`、`fzf` は `workforge` ではインストールしません。使うものは事前に PATH から実行できる状態にしてください。エディタ入力を使う場合は `VISUAL` または `EDITOR` を設定してください。

## インストール

```bash
npm install -g github:svjunic/workforge
wf --help

cd /path/to/target-git-repo
wf init
wf create "ログイン画面を修正する"
wf run [taskId]
```

コミット済みの CLI bundle をインストールし、`wf` コマンドをグローバルに使えるようにします。

## 開発用の実行

WorkForge 自体を変更したい場合はこの手順を使います。

```bash
git clone https://github.com/svjunic/workforge.git
cd workforge
npm ci
npm run dev -- --help
npm run dev -- init
npm run dev -- create "ログイン画面を修正する"
```

`package-lock.json` に記録された依存を再現するため `npm ci` を使います。

ローカル checkout を実際の `wf` コマンドとして試したい場合は、グローバルに link します。

```bash
npm run build
npm link
wf --help
```

ソース変更後は、link された `wf` コマンドが最新の `dist/cli.js` を使うように `npm run build` を再実行してください。不要になった link は `npm unlink -g workforge` で解除できます。

## ワークフロー例

```bash
wf create "Fix login validation"
wf run <taskId> --agent claude
```

WorkForge は `main` から `workforge/<id>-<slug>` のようなブランチを作成し、`.workforge/worktrees/<id>` に worktree を追加して、選択した adapter を tmux で起動します。

実行中は以下で状態やログを確認し、必要に応じて停止・再開できます。

```bash
wf status <taskId>
wf log <taskId>
wf stop <taskId>
wf resume <taskId>
```

adapter の作業が終わったら差分を確認します。

```bash
wf diff <taskId>
```

その後は通常の git workflow で確認、テスト、commit、merge を行います。不要になった task worktree は削除します。

```bash
wf delete <taskId>
```

## コマンド

### `wf init`

`.workforge/config.json` を対話式に作成します。WorkForge は各設定項目を順番に質問し、最後の回答後に config を書き込みます。他のコマンドを使う前に、対象 git リポジトリごとに一度実行してください。

### `wf create [title] [--description <text>]`

`main` から `workforge/<id>-<slug>` ブランチを作成し、`.workforge/worktrees/<id>` に worktree を作ります。タスク状態は `created` になります。

`title` を省略すると、`VISUAL` または `EDITOR` のエディタで Markdown テンプレートを開きます。編集後、最初の H1 をタスクタイトル、本文全体をタスク説明として保存します。title 省略時は `--description` を同時指定できません。

### `wf list [--all]`

タスク一覧を作成時刻の新しい順に表示します。既定では `deleted` のタスクを表示しません。`--all` を指定すると `deleted` を含むすべてのタスクを表示します。

### `wf status [taskId]`

タスク詳細と tmux の状態を表示します。`taskId` を省略した場合は簡易一覧を表示します。

### `wf run [taskId] [--agent claude|codex|aider|copilot]`

選択した adapter をタスクの worktree で tmux 起動します。`taskId` を省略した場合は `fzf`、または番号入力で未削除タスクを選択します。tmux 内から実行した場合は現在の window 内に新しい pane を作成し、tmux 外から実行した場合は従来どおりタスク専用 session を作成します。`--agent` は `.workforge/config.json` の `defaultAgent` より優先されます。タスク状態は `running` になります。

agent ごとの起動挙動:

- Claude: `--permission-mode plan` を付けて起動します。
- Aider: `--architect` を付けて architect mode で起動します。
- Copilot: `--mode plan -i` を付けて GitHub Copilot CLI の plan mode で対話起動します。
- Codex: 追加の mode 引数なしで起動します。

WorkForge は、タスクタイトルと説明に加えて「この git worktree の中だけで作業すること」「main の worktree を変更しないこと」「実装から検証まで完了すること」をプロンプトへ追記します。各 adapter には、この合成済みプロンプトを渡します。

### `wf stop <taskId>`

対象タスクの tmux pane/session に `Ctrl-C` を送り、タスク状態を `stopped` にします。

### `wf resume <taskId>`

同じ worktree で adapter を再起動します。タスク状態は `running` になります。Claude adapter では `--permission-mode auto` を付けて起動します。Aider adapter は `--architect` を再度付けます。Copilot adapter は `--mode plan -i` を再度付けます。Codex adapter には同等の mode 引数を付けません。

### `wf diff <taskId>`

タスク worktree の差分を表示し、`.workforge/diffs/<taskId>.patch` に保存します。タスク状態は `review` になります。

### `wf comment <taskId> <text>`

`.workforge/comments/<taskId>.jsonl` にコメントを追記します。

### `wf log <taskId>`

`.workforge/logs/<taskId>.log` に保存された tmux ログを表示します。

### `wf delete [taskId] [--force] [--all]`

タスク worktree を削除し、タスク状態を `deleted` にします。`taskId` を省略した場合は `fzf`、または番号入力で未削除タスクを選択します。`--all` は未削除タスクをすべて削除します。全削除前には確認プロンプトを表示します。worktree 削除に失敗した場合、意図した削除なら `--force` を付けて再実行します。

## `.workforge/config.json`

`wf init` により、対象 git リポジトリ内へ以下の設定が作成されます。

```json
{
  "defaultAgent": "claude",
  "worktreeRoot": ".workforge/worktrees",
  "tmuxSessionPrefix": "workforge",
  "keepPaneOnDone": true,
  "tmuxPanePlacement": "rightColumnPairs"
}
```

`defaultAgent` は `claude`、`codex`、`aider`、`copilot` のいずれかを指定できます。

`tmuxPanePlacement` は `rightColumnPairs` または `default` を指定できます。`rightColumnPairs` は tmux 内で `run` / `resume` したとき、1枚目を右に作り、次をその下に作り、以後同じ流れを繰り返します。`default` は tmux の既定 split に任せます。tmux 外で実行して task 専用 session を作る場合、この設定は使いません。

## create テンプレート

`wf init` により `.workforge/create-template.md` が作成されます。`wf create` で title を省略したときは、このテンプレートをエディタで開きます。対象リポジトリごとに内容を変更できます。

## 作成されるファイル

対象 git リポジトリには、管理ファイルとして `.workforge/` 配下を作成します。

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

`wf create` 時には、タスク worktree へ既知のローカル AI 設定もコピーします。コピー対象は `AGENTS.local.md`、`CLAUDE.local.md`、`CONVENTIONS.md`、`settings.local.json`、`.codex`、`.aider.conf.yml`、`.aider.conf.yaml`、`.aiderignore`、`.claude/skills`、`.claude/agents`、`.claude/rules`、`.claude/docs`、`.claude/commands`、`.github/copilot-instructions.md`、`.github/instructions` です。コピー元がないものは無視し、コピー先に同名ファイルやディレクトリがある場合は上書きしません。

## 制約

- `main` は直接変更しません。
- 1 task = 1 branch = 1 worktree です。
- AI プロセス終了後も、既定では tmux pane/session を残します。
- 停止したタスクは `resume` で再開します。
- 自動 commit、merge、push、PR 作成は行いません。差分確認後は通常の git workflow で進めます。
- ベースブランチは現在 `main` 固定です。任意のベースブランチ指定には未対応です。
- `tmux`、AI adapter、`fzf` のインストール、認証、モデル設定は行いません。
- `git worktree` は tracked ファイルだけを checkout します。未追跡または `.gitignore` 済みのローカル AI 設定は通常コピーされませんが、WorkForge は上記の既知パスだけを `wf create` 時にコピーします。
- 作成済みタスクへ、親 worktree 側のローカル AI 設定変更を後から自動同期することはありません。必要な場合はタスク worktree 側で手動更新してください。
- git リポジトリ外、初期コミットなし、`tmux` なし、adapter コマンドなし、設定不正は明確なエラーにします。

## 検証

```bash
npm run typecheck
npm run build
npm run dev -- --help
```
