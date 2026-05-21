import { Command } from "commander";
import { execa } from "execa";
import { customAlphabet } from "nanoid";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import { buildAgentAdapter, buildAgentPrompt, buildTmuxShellCommand, formatSupportedAgents, resolveAgent } from "./agents.js";
import { COMMENTS_DIR, CONFIG_FILE, DIFFS_DIR, LOGS_DIR } from "./constants.js";
import { CliError } from "./errors.js";
import { ensureBaseBranch, ensureInitialCommit, git, gitAt, loadRepoContext } from "./git.js";
import { copyLocalAiSettings } from "./local-settings.js";
import { SUPPORTED_AGENTS } from "./schemas.js";
import { defaultConfig, ensureInitialized, ensureWorkforgeFiles, loadConfig, loadTasks, saveTasks, writeJson } from "./storage.js";
import { ensureCommand, shellQuote } from "./system.js";
import {
  confirmPrompt,
  findTask,
  formatTaskChoice,
  selectableTasks,
  selectTaskId,
  slugify,
  updateTask,
  visibleTasks
} from "./tasks.js";
import { resolveCreateInput } from "./template.js";
import { killTmuxTarget, startTmuxTask, tmuxTargetExists, tmuxTargetForTask } from "./tmux.js";
import type { Config, RepoContext, Task, TmuxPanePlacement, TmuxShellMode } from "./types.js";

const taskId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

export function buildProgram() {
  const program = new Command();

  program
    .name("wf")
    .description("git worktree と tmux pane/session で AI タスクをローカル実行する CLI。")
    .version("0.1.0", "-V, --version", "バージョン番号を表示します。")
    .helpOption("-h, --help", "ヘルプを表示します。")
    .addHelpCommand("help [command]", "コマンドのヘルプを表示します。");

  program
    .command("init")
    .description(".workforge/config.json を対話式に作成します。")
    .action(async () => {
      const ctx = await loadRepoContext();
      await ensureWorkforgeFiles(ctx);

      const configPath = path.join(ctx.workforgeDir, CONFIG_FILE);
      if (await fileExists(configPath)) {
        if (!await confirmPrompt(`${path.relative(ctx.root, configPath)} は既に存在します。上書きしますか? [y/N] `)) {
          console.log("初期化を中止しました。");
          return;
        }
      }

      const config = await promptConfig();
      await writeJson(configPath, config);
      console.log(`作成しました: ${path.relative(ctx.root, configPath)}`);
    });

  program
    .command("create")
    .argument("[title]", "タスクタイトル")
    .option("--description <text>", "タスクの説明")
    .action(async (title: string | undefined, options: { description?: string }) => {
      const ctx = await loadRepoContext();
      await ensureInitialized(ctx);
      await ensureInitialCommit(ctx);
      await ensureBaseBranch(ctx, "main");

      const input = await resolveCreateInput(ctx, title, options);
      const config = await loadConfig(ctx);
      const tasks = await loadTasks(ctx);
      const id = taskId();
      const slug = slugify(input.title);
      const branch = `workforge/${id}-${slug}`;
      const worktreePath = path.resolve(ctx.root, config.worktreeRoot, id);

      await git(ctx, ["branch", branch, "main"]);
      await git(ctx, ["worktree", "add", worktreePath, branch]);
      await copyLocalAiSettings(ctx, worktreePath);

      const now = new Date().toISOString();
      const task: Task = {
        id,
        title: input.title,
        description: input.description,
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
    .option("--all", "deleted を含むすべてのタスクを表示します")
    .description("タスク一覧を表示します。")
    .action(async (options: { all?: boolean }) => {
      const ctx = await loadRepoContext();
      await ensureInitialized(ctx);
      const tasks = await loadTasks(ctx);
      const listedTasks = visibleTasks(tasks.tasks, Boolean(options.all));

      if (listedTasks.length === 0) {
        console.log("タスクはありません。");
        return;
      }

      for (const task of listedTasks) {
        console.log(`${task.createdAt}\t${task.id}\t${task.status}\t${task.branch}\t${task.title}`);
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
    .argument("[taskId]", "タスクID")
    .option("--agent <agent>", `エージェント adapter: ${formatSupportedAgents()}`)
    .description("タスク用のエージェントを tmux で起動します。")
    .action(async (id: string | undefined, options: { agent?: string }) => {
      const taskId = id ?? await selectTaskIdFromRepo("実行するタスクを選択してください");
      await runTask(taskId, options.agent, false);
    });

  program
    .command("stop")
    .argument("[taskId]", "タスクID")
    .description("実行中のタスクを停止します。")
    .action(async (id: string | undefined) => {
      const ctx = await loadRepoContext();
      await ensureInitialized(ctx);
      const tasks = await loadTasks(ctx);
      const task = findTask(tasks.tasks, id ?? await selectTaskId("停止するタスクを選択してください", tasks.tasks));

      if (await tmuxTargetExists(task)) {
        await execa("tmux", ["send-keys", "-t", tmuxTargetForTask(task), "C-c"]);
      }

      updateTask(task, { status: "stopped" });
      await saveTasks(ctx, tasks);
      console.log(`停止しました: ${task.id}`);
    });

  program
    .command("resume")
    .argument("[taskId]", "タスクID")
    .description("停止したタスクのエージェントを再起動します。")
    .action(async (id: string | undefined) => {
      const taskId = id ?? await selectTaskIdFromRepo("再開するタスクを選択してください");
      await runTask(taskId, undefined, true);
    });

  program
    .command("diff")
    .argument("[taskId]", "タスクID")
    .description("タスク worktree の差分を表示して保存します。")
    .action(async (id: string | undefined) => {
      const ctx = await loadRepoContext();
      await ensureInitialized(ctx);
      const tasks = await loadTasks(ctx);
      const task = findTask(tasks.tasks, id ?? await selectTaskId("差分を表示するタスクを選択してください", tasks.tasks));
      const diff = await gitAt(task.worktreePath, ["diff"], { reject: false });
      const stdout = typeof diff.stdout === "string" ? diff.stdout : "";
      const diffPath = path.join(ctx.workforgeDir, DIFFS_DIR, `${task.id}.patch`);
      await writeFile(diffPath, stdout, "utf8");
      updateTask(task, { status: "review" });
      await saveTasks(ctx, tasks);
      process.stdout.write(stdout);
      console.error(`差分を保存しました: ${diffPath}`);
    });

  program
    .command("comment")
    .argument("[taskId]", "タスクID")
    .argument("[text]", "コメント本文")
    .option("--text <text>", "コメント本文。taskId 省略時はこの option を指定します")
    .description("タスクコメントを追記します。")
    .action(async (id: string | undefined, text: string | undefined, options: { text?: string }) => {
      const ctx = await loadRepoContext();
      await ensureInitialized(ctx);
      const tasks = await loadTasks(ctx);
      const commentText = text ?? options.text;
      if (!commentText) throw new CliError("コメント本文を指定してください。taskId を省略する場合は --text を使ってください。");
      const task = findTask(tasks.tasks, id ?? await selectTaskId("コメントするタスクを選択してください", tasks.tasks));
      const commentPath = path.join(ctx.workforgeDir, COMMENTS_DIR, `${task.id}.jsonl`);
      const record = JSON.stringify({ taskId: task.id, text: commentText, createdAt: new Date().toISOString() });
      await appendFile(commentPath, `${record}\n`, "utf8");
      console.log(`コメントを追加しました: ${task.id}`);
    });

  program
    .command("log")
    .argument("[taskId]", "タスクID")
    .description("保存済みの tmux ログを表示します。")
    .action(async (id: string | undefined) => {
      const ctx = await loadRepoContext();
      await ensureInitialized(ctx);
      const tasks = await loadTasks(ctx);
      const task = findTask(tasks.tasks, id ?? await selectTaskId("ログを表示するタスクを選択してください", tasks.tasks));
      const logPath = path.join(ctx.workforgeDir, LOGS_DIR, `${task.id}.log`);
      try {
        process.stdout.write(await readFile(logPath, "utf8"));
      } catch {
        throw new CliError(`タスク ${task.id} のログが見つかりません。`);
      }
    });

  program
    .command("delete")
    .argument("[taskId]", "タスクID")
    .option("--force", "git worktree の削除を強制します")
    .option("--all", "未削除のタスクをすべて削除します")
    .description("タスク worktree を削除し、状態を deleted にします。")
    .action(async (id: string | undefined, options: { force?: boolean; all?: boolean }) => {
      const ctx = await loadRepoContext();
      await ensureInitialized(ctx);
      const tasks = await loadTasks(ctx);

      if (options.all && id) {
        throw new CliError("--all と taskId は同時に指定できません。");
      }

      if (options.all) {
        const targets = selectableTasks(tasks.tasks);
        if (targets.length === 0) throw new CliError("削除対象のタスクはありません。");

        console.log("削除対象:");
        for (const task of targets) {
          console.log(formatTaskChoice(task));
        }
        if (!await confirmPrompt(`${targets.length} 件のタスクをすべて削除しますか? [y/N] `)) {
          console.log("削除を中止しました。");
          return;
        }

        for (const task of targets) {
          await deleteTask(ctx, task, { force: options.force });
          await saveTasks(ctx, tasks);
          console.log(`削除しました: ${task.id}`);
        }
        return;
      }

      const taskId = id ?? await selectTaskId("削除するタスクを選択してください", tasks.tasks);
      const task = findTask(tasks.tasks, taskId);

      await deleteTask(ctx, task, { force: options.force });
      await saveTasks(ctx, tasks);
      console.log(`削除しました: ${task.id}`);
    });

  return program;
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
  const adapter = buildAgentAdapter(agent, isResume);
  await ensureAdapterCommand(adapter.command, config.tmuxShellMode, `${agent} adapter を使うには ${adapter.command} が必要です。`);

  const logPath = path.join(ctx.workforgeDir, LOGS_DIR, `${task.id}.log`);
  const prompt = buildAgentPrompt(task, isResume);
  const shellCommand = buildTmuxShellCommand(adapter, prompt, logPath, config.keepPaneOnDone, config.tmuxShellMode);

  if (await tmuxTargetExists(task)) {
    await killTmuxTarget(task);
  }

  const tmuxTarget = await startTmuxTask(ctx, config, task, shellCommand);

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

async function selectTaskIdFromRepo(prompt: string): Promise<string> {
  const ctx = await loadRepoContext();
  await ensureInitialized(ctx);
  return selectTaskId(prompt, (await loadTasks(ctx)).tasks);
}

async function promptConfig(): Promise<Config> {
  const defaults = defaultConfig();
  return {
    defaultAgent: await selectOption("defaultAgent", [...SUPPORTED_AGENTS], defaults.defaultAgent),
    worktreeRoot: await selectDefaultOrCustom("worktreeRoot", defaults.worktreeRoot),
    tmuxSessionPrefix: await selectDefaultOrCustom("tmuxSessionPrefix", defaults.tmuxSessionPrefix),
    keepPaneOnDone: await selectBoolean("keepPaneOnDone", defaults.keepPaneOnDone),
    tmuxPanePlacement: await selectOption<TmuxPanePlacement>(
      "tmuxPanePlacement",
      ["rightColumnPairs", "default"],
      defaults.tmuxPanePlacement
    ),
    tmuxShellMode: await selectOption<TmuxShellMode>(
      "tmuxShellMode",
      ["loginInteractive", "direct"],
      defaults.tmuxShellMode
    )
  };
}

async function ensureAdapterCommand(command: string, shellMode: TmuxShellMode, message: string) {
  if (shellMode === "direct") {
    await ensureCommand(command, message);
    return;
  }

  const shell = process.env.SHELL || "/bin/sh";
  const result = await execa(shell, ["-lic", `command -v ${shellQuote(command)} >/dev/null`], { reject: false });
  if (result.failed) throw new CliError(message);
}

async function selectOption<T extends string>(name: string, choices: readonly T[], defaultValue: T): Promise<T> {
  ensureInteractivePrompt();
  console.log(`${name} を選択してください:`);
  choices.forEach((choice, index) => {
    const suffix = choice === defaultValue ? " (default)" : "";
    console.log(`${index + 1}. ${choice}${suffix}`);
  });

  const answer = await question("番号を入力してください: ");
  const selectedIndex = answer.trim() === "" ? choices.indexOf(defaultValue) + 1 : Number(answer.trim());
  if (!Number.isInteger(selectedIndex) || selectedIndex < 1 || selectedIndex > choices.length) {
    throw new CliError(`${name} の選択が不正です。`);
  }

  return choices[selectedIndex - 1]!;
}

async function selectDefaultOrCustom(name: string, defaultValue: string): Promise<string> {
  const mode = await selectOption(`${name} の設定方法`, ["default", "custom"], "default");
  if (mode === "default") return defaultValue;

  const value = (await question(`${name} を入力してください: `)).trim();
  if (!value) throw new CliError(`${name} は空にできません。`);
  return value;
}

async function selectBoolean(name: string, defaultValue: boolean): Promise<boolean> {
  const selected = await selectOption(name, ["true", "false"], defaultValue ? "true" : "false");
  return selected === "true";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}

function ensureInteractivePrompt() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError("対話プロンプトを表示できません。TTY で wf init を実行してください。");
  }
}

async function question(prompt: string): Promise<string> {
  ensureInteractivePrompt();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

async function deleteTask(ctx: RepoContext, task: Task, options: { force?: boolean }) {
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
}
