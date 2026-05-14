#!/usr/bin/env node

import { Command } from "commander";
import { execa, type Options } from "execa";
import { customAlphabet } from "nanoid";
import { mkdir, readFile, rm, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { z } from "zod";

const AITASK_DIR = ".aitask";
const TASKS_FILE = "tasks.json";
const CONFIG_FILE = "config.json";
const LOGS_DIR = "logs";
const COMMENTS_DIR = "comments";
const DIFFS_DIR = "diffs";
const WORKTREES_DIR = "worktrees";

const taskId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

const AgentSchema = z.enum(["claude", "codex"]);
type AgentName = z.infer<typeof AgentSchema>;

const ConfigSchema = z.object({
  defaultAgent: AgentSchema.default("claude"),
  worktreeRoot: z.string().default(".aitask/worktrees"),
  tmuxSessionPrefix: z.string().default("aitask"),
  keepPaneOnDone: z.boolean().default(true)
});

type Config = z.infer<typeof ConfigSchema>;

const TaskStatusSchema = z.enum(["created", "running", "stopped", "review", "deleted"]);
type TaskStatus = z.infer<typeof TaskStatusSchema>;

const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  slug: z.string(),
  branch: z.string(),
  baseBranch: z.string(),
  worktreePath: z.string(),
  status: TaskStatusSchema,
  agent: AgentSchema.optional(),
  tmuxSession: z.string().optional(),
  tmuxWindow: z.string().optional(),
  tmuxTargetType: z.enum(["session", "window", "pane"]).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

type Task = z.infer<typeof TaskSchema>;

const TasksSchema = z.object({
  tasks: z.array(TaskSchema)
});

interface RepoContext {
  root: string;
  aitaskDir: string;
}

interface AgentAdapter {
  name: AgentName;
  command: string;
  args: string[];
}

const adapters: Record<AgentName, AgentAdapter> = {
  claude: { name: "claude", command: "claude", args: [] },
  codex: { name: "codex", command: "codex", args: [] }
};

class CliError extends Error {}

async function main() {
  const program = new Command();

  program
    .name("aitask")
    .description("git worktree と tmux pane/session で AI タスクをローカル実行する CLI。")
    .version("0.1.0", "-V, --version", "バージョン番号を表示します。")
    .helpOption("-h, --help", "ヘルプを表示します。")
    .addHelpCommand("help [command]", "コマンドのヘルプを表示します。");

  program
    .command("create")
    .argument("<title>", "タスクタイトル")
    .option("--description <text>", "タスクの説明")
    .action(async (title: string, options: { description?: string }) => {
      const ctx = await loadRepoContext();
      await ensureInitialized(ctx);
      await ensureInitialCommit(ctx);
      await ensureBaseBranch(ctx, "main");

      const config = await loadConfig(ctx);
      const tasks = await loadTasks(ctx);
      const id = taskId();
      const slug = slugify(title);
      const branch = `aitask/${id}-${slug}`;
      const worktreePath = path.resolve(ctx.root, config.worktreeRoot, id);

      await git(ctx, ["branch", branch, "main"]);
      await git(ctx, ["worktree", "add", worktreePath, branch]);

      const now = new Date().toISOString();
      const task: Task = {
        id,
        title,
        description: options.description,
        slug,
        branch,
        baseBranch: "main",
        worktreePath,
        status: "created",
        createdAt: now,
        updatedAt: now
      };

      tasks.tasks.push(task);
      await saveTasks(ctx, tasks);
      console.log(`作成しました: ${id}`);
      console.log(`ブランチ: ${branch}`);
      console.log(`worktree: ${worktreePath}`);
    });

  program
    .command("list")
    .description("タスク一覧を表示します。")
    .action(async () => {
      const ctx = await loadRepoContext();
      await ensureInitialized(ctx);
      const tasks = await loadTasks(ctx);
      if (tasks.tasks.length === 0) {
        console.log("タスクはありません。");
        return;
      }

      for (const task of tasks.tasks) {
        console.log(`${task.id}\t${task.status}\t${task.branch}\t${task.title}`);
      }
    });

  program
    .command("status")
    .argument("[taskId]", "タスクID")
    .description("タスク詳細と tmux の状態を表示します。")
    .action(async (id?: string) => {
      const ctx = await loadRepoContext();
      await ensureInitialized(ctx);
      const tasks = await loadTasks(ctx);

      if (!id) {
        for (const task of tasks.tasks) {
          console.log(`${task.id}\t${task.status}\t${task.title}`);
        }
        return;
      }

      const task = findTask(tasks.tasks, id);
      console.log(`ID: ${task.id}`);
      console.log(`タイトル: ${task.title}`);
      if (task.description) console.log(`説明: ${task.description}`);
      console.log(`状態: ${task.status}`);
      console.log(`ブランチ: ${task.branch}`);
      console.log(`worktree: ${task.worktreePath}`);
      if (task.agent) console.log(`エージェント: ${task.agent}`);
      if (task.tmuxSession) {
        const target = tmuxTargetForTask(task);
        const alive = await tmuxTargetExists(task);
        console.log(`tmux: ${target} (${alive ? "存在します" : "見つかりません"})`);
      }
    });

  program
    .command("run")
    .argument("<taskId>", "タスクID")
    .option("--agent <agent>", "エージェント adapter: claude または codex")
    .description("タスク用のエージェントを tmux で起動します。")
    .action(async (id: string, options: { agent?: string }) => {
      await runTask(id, options.agent, false);
    });

  program
    .command("stop")
    .argument("<taskId>", "タスクID")
    .description("実行中のタスクを停止します。")
    .action(async (id: string) => {
      const ctx = await loadRepoContext();
      await ensureInitialized(ctx);
      const tasks = await loadTasks(ctx);
      const task = findTask(tasks.tasks, id);

      if (await tmuxTargetExists(task)) {
        await execa("tmux", ["send-keys", "-t", tmuxTargetForTask(task), "C-c"]);
      }

      updateTask(task, { status: "stopped" });
      await saveTasks(ctx, tasks);
      console.log(`停止しました: ${task.id}`);
    });

  program
    .command("resume")
    .argument("<taskId>", "タスクID")
    .description("停止したタスクのエージェントを再起動します。")
    .action(async (id: string) => {
      await runTask(id, undefined, true);
    });

  program
    .command("diff")
    .argument("<taskId>", "タスクID")
    .description("タスク worktree の差分を表示して保存します。")
    .action(async (id: string) => {
      const ctx = await loadRepoContext();
      await ensureInitialized(ctx);
      const tasks = await loadTasks(ctx);
      const task = findTask(tasks.tasks, id);
      const diff = await gitAt(task.worktreePath, ["diff"], { reject: false });
      const stdout = typeof diff.stdout === "string" ? diff.stdout : "";
      const diffPath = path.join(ctx.aitaskDir, DIFFS_DIR, `${task.id}.patch`);
      await writeFile(diffPath, stdout, "utf8");
      updateTask(task, { status: "review" });
      await saveTasks(ctx, tasks);
      process.stdout.write(stdout);
      console.error(`差分を保存しました: ${diffPath}`);
    });

  program
    .command("comment")
    .argument("<taskId>", "タスクID")
    .argument("<text>", "コメント本文")
    .description("タスクコメントを追記します。")
    .action(async (id: string, text: string) => {
      const ctx = await loadRepoContext();
      await ensureInitialized(ctx);
      const tasks = await loadTasks(ctx);
      const task = findTask(tasks.tasks, id);
      const commentPath = path.join(ctx.aitaskDir, COMMENTS_DIR, `${task.id}.jsonl`);
      const record = JSON.stringify({ taskId: task.id, text, createdAt: new Date().toISOString() });
      await appendFile(commentPath, `${record}\n`, "utf8");
      console.log(`コメントを追加しました: ${task.id}`);
    });

  program
    .command("log")
    .argument("<taskId>", "タスクID")
    .description("保存済みの tmux ログを表示します。")
    .action(async (id: string) => {
      const ctx = await loadRepoContext();
      await ensureInitialized(ctx);
      const tasks = await loadTasks(ctx);
      const task = findTask(tasks.tasks, id);
      const logPath = path.join(ctx.aitaskDir, LOGS_DIR, `${task.id}.log`);
      try {
        process.stdout.write(await readFile(logPath, "utf8"));
      } catch {
        throw new CliError(`タスク ${task.id} のログが見つかりません。`);
      }
    });

  program
    .command("delete")
    .argument("<taskId>", "タスクID")
    .option("--force", "git worktree の削除を強制します")
    .description("タスク worktree を削除し、状態を deleted にします。")
    .action(async (id: string, options: { force?: boolean }) => {
      const ctx = await loadRepoContext();
      await ensureInitialized(ctx);
      const tasks = await loadTasks(ctx);
      const task = findTask(tasks.tasks, id);

      if (await tmuxTargetExists(task)) {
        await killTmuxTarget(task);
      }

      const args = ["worktree", "remove"];
      if (options.force) args.push("--force");
      args.push(task.worktreePath);

      const removal = await git(ctx, args, { reject: false });
      if (removal.failed && !options.force) {
        throw new CliError(`worktree を削除できませんでした。意図した削除なら --force を付けて再実行してください。\n${removal.stderr}`);
      }

      if (removal.failed) {
        await rm(task.worktreePath, { recursive: true, force: true });
      }

      updateTask(task, { status: "deleted" });
      await saveTasks(ctx, tasks);
      console.log(`削除しました: ${task.id}`);
    });

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CliError) {
      console.error(`aitask: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

async function runTask(id: string, agentOption: string | undefined, isResume: boolean) {
  const ctx = await loadRepoContext();
  await ensureInitialized(ctx);
  await ensureCommand("tmux", "タスクを実行するには tmux が必要です。");

  const config = await loadConfig(ctx);
  const tasks = await loadTasks(ctx);
  const task = findTask(tasks.tasks, id);
  if (task.status === "deleted") throw new CliError(`タスク ${task.id} は削除済みです。`);

  const agent = resolveAgent(agentOption, config);
  const adapter = adapters[agent];
  await ensureCommand(adapter.command, `${agent} adapter を使うには ${adapter.command} が必要です。`);

  const logPath = path.join(ctx.aitaskDir, LOGS_DIR, `${task.id}.log`);
  const prompt = buildAgentPrompt(task, isResume);
  const shellCommand = buildTmuxShellCommand(adapter, prompt, logPath, config.keepPaneOnDone);

  if (await tmuxTargetExists(task)) {
    await killTmuxTarget(task);
  }

  const tmuxTarget = await startTmuxTask(config, task, shellCommand);

  updateTask(task, {
    status: "running",
    agent,
    tmuxSession: tmuxTarget.session,
    tmuxWindow: tmuxTarget.target,
    tmuxTargetType: tmuxTarget.type
  });
  await saveTasks(ctx, tasks);
  console.log(`${isResume ? "再開しました" : "実行を開始しました"}: ${task.id}`);
  console.log(`tmux: ${tmuxTarget.target}`);
  console.log(`ログ: ${logPath}`);
}

async function loadRepoContext(): Promise<RepoContext> {
  const result = await execa("git", ["rev-parse", "--show-toplevel"], { reject: false });
  if (result.failed) throw new CliError("aitask は git リポジトリ内で実行してください。");
  const root = result.stdout.trim();
  return { root, aitaskDir: path.join(root, AITASK_DIR) };
}

async function ensureInitialized(ctx: RepoContext) {
  await mkdir(ctx.aitaskDir, { recursive: true });
  await mkdir(path.join(ctx.aitaskDir, LOGS_DIR), { recursive: true });
  await mkdir(path.join(ctx.aitaskDir, COMMENTS_DIR), { recursive: true });
  await mkdir(path.join(ctx.aitaskDir, DIFFS_DIR), { recursive: true });
  await mkdir(path.join(ctx.aitaskDir, WORKTREES_DIR), { recursive: true });

  const configPath = path.join(ctx.aitaskDir, CONFIG_FILE);
  const tasksPath = path.join(ctx.aitaskDir, TASKS_FILE);

  try {
    await readFile(configPath, "utf8");
  } catch {
    await writeJson(configPath, defaultConfig());
  }

  try {
    await readFile(tasksPath, "utf8");
  } catch {
    await writeJson(tasksPath, { tasks: [] });
  }
}

async function loadConfig(ctx: RepoContext): Promise<Config> {
  const configPath = path.join(ctx.aitaskDir, CONFIG_FILE);
  try {
    return ConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new CliError(`${path.relative(ctx.root, configPath)} が不正です: ${error.message}`);
    }
    throw new CliError(`${path.relative(ctx.root, configPath)} を読み込めませんでした。`);
  }
}

async function loadTasks(ctx: RepoContext): Promise<{ tasks: Task[] }> {
  const tasksPath = path.join(ctx.aitaskDir, TASKS_FILE);
  try {
    return TasksSchema.parse(JSON.parse(await readFile(tasksPath, "utf8")));
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new CliError(`${path.relative(ctx.root, tasksPath)} が不正です: ${error.message}`);
    }
    throw new CliError(`${path.relative(ctx.root, tasksPath)} を読み込めませんでした。`);
  }
}

async function saveTasks(ctx: RepoContext, tasks: { tasks: Task[] }) {
  await writeJson(path.join(ctx.aitaskDir, TASKS_FILE), TasksSchema.parse(tasks));
}

function findTask(tasks: Task[], id: string): Task {
  const matches = tasks.filter((task) => task.id === id || task.id.startsWith(id));
  if (matches.length === 0) throw new CliError(`タスクが見つかりません: ${id}`);
  if (matches.length > 1) throw new CliError(`タスクIDが曖昧です: ${id}`);
  return matches[0]!;
}

function updateTask(task: Task, patch: Partial<Task>) {
  Object.assign(task, patch, { updatedAt: new Date().toISOString() });
}

function resolveAgent(agentOption: string | undefined, config: Config): AgentName {
  if (!agentOption) return config.defaultAgent;
  const parsed = AgentSchema.safeParse(agentOption);
  if (!parsed.success) throw new CliError(`未対応のエージェントです: ${agentOption}。claude または codex を指定してください。`);
  return parsed.data;
}

function defaultConfig(): Config {
  return {
    defaultAgent: "claude",
    worktreeRoot: ".aitask/worktrees",
    tmuxSessionPrefix: "aitask",
    keepPaneOnDone: true
  };
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "task";
}

function tmuxSessionName(config: Config, id: string): string {
  return `${config.tmuxSessionPrefix}-${id}`;
}

function tmuxTargetForTask(task: Task): string {
  if (!task.tmuxSession) return "";
  if (!task.tmuxWindow) return task.tmuxSession;
  if (task.tmuxWindow.includes(":")) return task.tmuxWindow;
  return `${task.tmuxSession}:${task.tmuxWindow}`;
}

async function startTmuxTask(config: Config, task: Task, shellCommand: string): Promise<{ session: string; target: string; type: "session" | "pane" }> {
  if (process.env.TMUX) {
    const started = await execa("tmux", [
      "split-window",
      "-P",
      "-F",
      "#{session_name}:#{window_index}.#{pane_index}",
      "-c",
      task.worktreePath,
      shellCommand
    ], { reject: false });
    if (started.failed) {
      throw new CliError(`tmux pane を起動できませんでした: ${started.stderr || started.shortMessage}`);
    }

    const target = started.stdout.trim();
    if (!target) {
      throw new CliError("作成した tmux pane の target を取得できませんでした。");
    }
    return { session: target.split(":")[0]!, target, type: "pane" };
  }

  const session = tmuxSessionName(config, task.id);
  const started = await execa("tmux", [
    "new-session",
    "-d",
    "-s",
    session,
    "-c",
    task.worktreePath,
    shellCommand
  ], { reject: false });
  if (started.failed) {
    throw new CliError(`tmux セッションを起動できませんでした: ${started.stderr || started.shortMessage}`);
  }

  return { session, target: session, type: "session" };
}

function buildAgentPrompt(task: Task, isResume: boolean): string {
  const lines = [
    `aitask タスク ${task.id} を${isResume ? "再開" : "実装"}してください: ${task.title}`,
    "",
    "この git worktree の中だけで作業してください。main の worktree は変更しないでください。",
    "実装から検証まで完了させてください。"
  ];
  if (task.description) lines.splice(2, 0, task.description, "");
  return lines.join("\n");
}

function buildTmuxShellCommand(adapter: AgentAdapter, prompt: string, logPath: string, keepPaneOnDone: boolean): string {
  const command = [adapter.command, ...adapter.args, prompt].map(shellQuote).join(" ");
  const logCommand = `tmux pipe-pane -o ${shellQuote(`cat >> ${logPath}`)}`;
  const suffix = keepPaneOnDone ? "; printf '\\n[aitask] プロセスが終了しました。この tmux pane/session を閉じるには Ctrl-D を押してください。\\n'; exec $SHELL" : "";
  return `${logCommand}; ${command}${suffix}`;
}

async function ensureInitialCommit(ctx: RepoContext) {
  const result = await git(ctx, ["rev-parse", "--verify", "HEAD"], { reject: false });
  if (result.failed) throw new CliError("このリポジトリには初期コミットがありません。");
}

async function ensureBaseBranch(ctx: RepoContext, branch: string) {
  const result = await git(ctx, ["rev-parse", "--verify", branch], { reject: false });
  if (result.failed) throw new CliError(`ベースブランチ '${branch}' が存在しません。`);
}

async function ensureCommand(command: string, message: string) {
  const result = await execa("command", ["-v", command], { shell: true, reject: false });
  if (result.failed || !result.stdout.trim()) throw new CliError(message);
}

async function tmuxTargetExists(task: Task): Promise<boolean> {
  if (!task.tmuxSession) return false;
  const result = await execa("tmux", ["display-message", "-p", "-t", tmuxTargetForTask(task), "#{session_name}:#{window_index}.#{pane_index}"], { reject: false });
  return !result.failed;
}

async function killTmuxTarget(task: Task) {
  const target = tmuxTargetForTask(task);
  if (task.tmuxTargetType === "session") {
    await execa("tmux", ["kill-session", "-t", target], { reject: false });
    return;
  }
  if (task.tmuxTargetType === "pane" || target.includes(".")) {
    await execa("tmux", ["kill-pane", "-t", target], { reject: false });
    return;
  }
  if (task.tmuxTargetType === "window" || task.tmuxWindow) {
    await execa("tmux", ["kill-window", "-t", target], { reject: false });
    return;
  }
  await execa("tmux", ["kill-session", "-t", target], { reject: false });
}

async function git(ctx: RepoContext, args: string[], options: Options = {}) {
  return execa("git", ["-C", ctx.root, ...args], options);
}

async function gitAt(cwd: string, args: string[], options: Options = {}) {
  return execa("git", ["-C", cwd, ...args], options);
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

main();
