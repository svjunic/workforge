#!/usr/bin/env node

// src/commands.ts
import { Command } from "commander";
import { execa as execa6 } from "execa";
import { customAlphabet } from "nanoid";
import { appendFile, readFile as readFile3, rm as rm2, writeFile as writeFile3 } from "node:fs/promises";
import path4 from "node:path";

// src/schemas.ts
import { z } from "zod";
var SUPPORTED_AGENTS = ["claude", "codex", "aider"];
var AgentSchema = z.enum(SUPPORTED_AGENTS);
var TmuxPanePlacementSchema = z.enum(["default", "rightColumnPairs"]);
var ConfigSchema = z.object({
  defaultAgent: AgentSchema.default("claude"),
  worktreeRoot: z.string().default(".workforge/worktrees"),
  tmuxSessionPrefix: z.string().default("workforge"),
  keepPaneOnDone: z.boolean().default(true),
  tmuxPanePlacement: TmuxPanePlacementSchema.default("rightColumnPairs")
});
var TmuxLayoutSchema = z.object({
  windows: z.record(z.object({
    anchorPaneId: z.string(),
    pendingTopPaneId: z.string().optional()
  })).default({})
});
var TaskStatusSchema = z.enum(["created", "running", "stopped", "review", "deleted"]);
var TaskSchema = z.object({
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
var TasksSchema = z.object({
  tasks: z.array(TaskSchema)
});

// src/system.ts
import { execa } from "execa";

// src/errors.ts
var CliError = class extends Error {
};

// src/system.ts
async function ensureCommand(command, message) {
  const result = await execa("command", ["-v", command], { shell: true, reject: false });
  if (result.failed || !result.stdout.trim()) throw new CliError(message);
}
async function commandExists(command) {
  const result = await execa("command", ["-v", command], { shell: true, reject: false });
  return !result.failed && Boolean(result.stdout.trim());
}
function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// src/agents.ts
var adapters = {
  claude: { name: "claude", command: "claude", args: [] },
  codex: { name: "codex", command: "codex", args: [] },
  aider: { name: "aider", command: "aider", args: [] }
};
function formatSupportedAgents() {
  return SUPPORTED_AGENTS.join(", ");
}
function resolveAgent(agentOption, config) {
  if (!agentOption) return config.defaultAgent;
  const parsed = AgentSchema.safeParse(agentOption);
  if (!parsed.success) throw new CliError(`\u672A\u5BFE\u5FDC\u306E\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u3067\u3059: ${agentOption}\u3002${formatSupportedAgents()} \u306E\u3044\u305A\u308C\u304B\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002`);
  return parsed.data;
}
function buildAgentAdapter(agent, isResume) {
  const adapter = adapters[agent];
  switch (agent) {
    case "claude":
      return {
        ...adapter,
        args: ["--permission-mode", isResume ? "auto" : "plan", ...adapter.args]
      };
    case "aider":
      return {
        ...adapter,
        args: ["--architect", ...adapter.args]
      };
    default:
      return adapter;
  }
}
function buildAgentPrompt(task, isResume) {
  const lines = [
    `WorkForge \u30BF\u30B9\u30AF ${task.id} \u3092${isResume ? "\u518D\u958B" : "\u5B9F\u88C5"}\u3057\u3066\u304F\u3060\u3055\u3044: ${task.title}`,
    "",
    "\u3053\u306E git worktree \u306E\u4E2D\u3060\u3051\u3067\u4F5C\u696D\u3057\u3066\u304F\u3060\u3055\u3044\u3002main \u306E worktree \u306F\u5909\u66F4\u3057\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002",
    "\u5B9F\u88C5\u304B\u3089\u691C\u8A3C\u307E\u3067\u5B8C\u4E86\u3055\u305B\u3066\u304F\u3060\u3055\u3044\u3002"
  ];
  if (task.description) lines.splice(2, 0, task.description, "");
  return lines.join("\n");
}
function buildTmuxShellCommand(adapter, prompt, logPath, keepPaneOnDone) {
  const command = [adapter.command, ...adapter.args, prompt].map(shellQuote).join(" ");
  const logCommand = `tmux pipe-pane -o ${shellQuote(`cat >> ${logPath}`)}`;
  const suffix = keepPaneOnDone ? "; printf '\\n[workforge] \u30D7\u30ED\u30BB\u30B9\u304C\u7D42\u4E86\u3057\u307E\u3057\u305F\u3002\u3053\u306E tmux pane/session \u3092\u9589\u3058\u308B\u306B\u306F Ctrl-D \u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002\\n'; exec $SHELL" : "";
  return `${logCommand}; ${command}${suffix}`;
}

// src/constants.ts
var WORKFORGE_DIR = ".workforge";
var TASKS_FILE = "tasks.json";
var CONFIG_FILE = "config.json";
var TMUX_LAYOUT_FILE = "tmux-layout.json";
var CREATE_TEMPLATE_FILE = "create-template.md";
var LOGS_DIR = "logs";
var COMMENTS_DIR = "comments";
var DIFFS_DIR = "diffs";
var WORKTREES_DIR = "worktrees";

// src/git.ts
import { execa as execa2 } from "execa";
import path from "node:path";
async function loadRepoContext() {
  const result = await execa2("git", ["rev-parse", "--show-toplevel"], { reject: false });
  if (result.failed) throw new CliError("wf \u306F git \u30EA\u30DD\u30B8\u30C8\u30EA\u5185\u3067\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
  const root = result.stdout.trim();
  return { root, workforgeDir: path.join(root, WORKFORGE_DIR) };
}
async function ensureInitialCommit(ctx) {
  const result = await git(ctx, ["rev-parse", "--verify", "HEAD"], { reject: false });
  if (result.failed) throw new CliError("\u3053\u306E\u30EA\u30DD\u30B8\u30C8\u30EA\u306B\u306F\u521D\u671F\u30B3\u30DF\u30C3\u30C8\u304C\u3042\u308A\u307E\u305B\u3093\u3002");
}
async function ensureBaseBranch(ctx, branch) {
  const result = await git(ctx, ["rev-parse", "--verify", branch], { reject: false });
  if (result.failed) throw new CliError(`\u30D9\u30FC\u30B9\u30D6\u30E9\u30F3\u30C1 '${branch}' \u304C\u5B58\u5728\u3057\u307E\u305B\u3093\u3002`);
}
async function git(ctx, args, options = {}) {
  return execa2("git", ["-C", ctx.root, ...args], options);
}
async function gitAt(cwd, args, options = {}) {
  return execa2("git", ["-C", cwd, ...args], options);
}

// src/storage.ts
import { mkdir as mkdir2, readFile as readFile2, writeFile as writeFile2 } from "node:fs/promises";
import path3 from "node:path";
import { z as z2 } from "zod";

// src/template.ts
import { execa as execa3 } from "execa";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
async function ensureCreateTemplate(ctx) {
  const templatePath = userCreateTemplatePath(ctx);
  try {
    await readFile(templatePath, "utf8");
  } catch {
    await mkdir(path2.dirname(templatePath), { recursive: true });
    await writeFile(templatePath, await readDefaultCreateTemplate(), "utf8");
  }
}
async function resolveCreateInput(ctx, title, options) {
  if (title) {
    return { title, description: options.description };
  }
  if (options.description) {
    throw new CliError("title \u3092\u7701\u7565\u3057\u3066\u30A8\u30C7\u30A3\u30BF\u5165\u529B\u3059\u308B\u5834\u5408\u3001--description \u306F\u6307\u5B9A\u3067\u304D\u307E\u305B\u3093\u3002");
  }
  const description = await editCreateTemplate(ctx);
  if (!description.trim()) {
    throw new CliError("\u30BF\u30B9\u30AF\u672C\u6587\u304C\u7A7A\u3067\u3059\u3002");
  }
  const extractedTitle = extractMarkdownTitle(description);
  if (!extractedTitle) {
    throw new CliError("\u30BF\u30B9\u30AF\u672C\u6587\u306E\u6700\u521D\u306E Markdown H1 \u3092 title \u3068\u3057\u3066\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
  }
  return { title: extractedTitle, description };
}
function userCreateTemplatePath(ctx) {
  return path2.join(ctx.workforgeDir, CREATE_TEMPLATE_FILE);
}
async function readDefaultCreateTemplate() {
  return readFile(defaultCreateTemplatePath(), "utf8");
}
function defaultCreateTemplatePath() {
  const currentDir = path2.dirname(fileURLToPath(import.meta.url));
  return path2.resolve(currentDir, "..", "templates", "create.md");
}
async function editCreateTemplate(ctx) {
  const editor = process.env.VISUAL || process.env.EDITOR;
  if (!editor) {
    throw new CliError("title \u3092\u7701\u7565\u3059\u308B\u5834\u5408\u306F VISUAL \u307E\u305F\u306F EDITOR \u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
  }
  const tempDir = await mkdtemp(path2.join(tmpdir(), "workforge-create-"));
  const tempPath = path2.join(tempDir, "task.md");
  await writeFile(tempPath, await readFile(userCreateTemplatePath(ctx), "utf8"), "utf8");
  try {
    const result = await execa3(editor, [tempPath], { stdio: "inherit", reject: false });
    if (result.failed) {
      throw new CliError(`\u30A8\u30C7\u30A3\u30BF\u3092\u7D42\u4E86\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F: ${result.shortMessage}`);
    }
    return await readFile(tempPath, "utf8");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
function extractMarkdownTitle(markdown) {
  const h1 = markdown.split(/\r?\n/).find((line) => line.startsWith("# ") && line.slice(2).trim());
  return h1?.slice(2).trim();
}

// src/storage.ts
async function ensureInitialized(ctx) {
  await mkdir2(ctx.workforgeDir, { recursive: true });
  await mkdir2(path3.join(ctx.workforgeDir, LOGS_DIR), { recursive: true });
  await mkdir2(path3.join(ctx.workforgeDir, COMMENTS_DIR), { recursive: true });
  await mkdir2(path3.join(ctx.workforgeDir, DIFFS_DIR), { recursive: true });
  await mkdir2(path3.join(ctx.workforgeDir, WORKTREES_DIR), { recursive: true });
  const configPath = path3.join(ctx.workforgeDir, CONFIG_FILE);
  const tasksPath = path3.join(ctx.workforgeDir, TASKS_FILE);
  try {
    await readFile2(configPath, "utf8");
  } catch {
    await writeJson(configPath, defaultConfig());
  }
  try {
    await readFile2(tasksPath, "utf8");
  } catch {
    await writeJson(tasksPath, { tasks: [] });
  }
  await ensureCreateTemplate(ctx);
}
async function loadConfig(ctx) {
  const configPath = path3.join(ctx.workforgeDir, CONFIG_FILE);
  try {
    return ConfigSchema.parse(JSON.parse(await readFile2(configPath, "utf8")));
  } catch (error) {
    if (error instanceof z2.ZodError) {
      throw new CliError(`${path3.relative(ctx.root, configPath)} \u304C\u4E0D\u6B63\u3067\u3059: ${error.message}`);
    }
    throw new CliError(`${path3.relative(ctx.root, configPath)} \u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002`);
  }
}
async function loadTasks(ctx) {
  const tasksPath = path3.join(ctx.workforgeDir, TASKS_FILE);
  try {
    return TasksSchema.parse(JSON.parse(await readFile2(tasksPath, "utf8")));
  } catch (error) {
    if (error instanceof z2.ZodError) {
      throw new CliError(`${path3.relative(ctx.root, tasksPath)} \u304C\u4E0D\u6B63\u3067\u3059: ${error.message}`);
    }
    throw new CliError(`${path3.relative(ctx.root, tasksPath)} \u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002`);
  }
}
async function saveTasks(ctx, tasks) {
  await writeJson(path3.join(ctx.workforgeDir, TASKS_FILE), TasksSchema.parse(tasks));
}
async function loadTmuxLayout(ctx) {
  const layoutPath = path3.join(ctx.workforgeDir, TMUX_LAYOUT_FILE);
  try {
    return TmuxLayoutSchema.parse(JSON.parse(await readFile2(layoutPath, "utf8")));
  } catch (error) {
    if (error instanceof z2.ZodError) {
      throw new CliError(`${path3.relative(ctx.root, layoutPath)} \u304C\u4E0D\u6B63\u3067\u3059: ${error.message}`);
    }
    return { windows: {} };
  }
}
async function saveTmuxLayout(ctx, layout) {
  await writeJson(path3.join(ctx.workforgeDir, TMUX_LAYOUT_FILE), TmuxLayoutSchema.parse(layout));
}
async function writeJson(filePath, value) {
  await writeFile2(filePath, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
function defaultConfig() {
  return {
    defaultAgent: "claude",
    worktreeRoot: ".workforge/worktrees",
    tmuxSessionPrefix: "workforge",
    keepPaneOnDone: true,
    tmuxPanePlacement: "rightColumnPairs"
  };
}

// src/tasks.ts
import { execa as execa4 } from "execa";
import { createInterface } from "node:readline/promises";
function visibleTasks(tasks, includeDeleted) {
  return (includeDeleted ? tasks : tasks.filter((task) => task.status !== "deleted")).map((task, index) => ({ task, index })).sort((a, b) => {
    const byCreatedAt = b.task.createdAt.localeCompare(a.task.createdAt);
    return byCreatedAt || a.index - b.index;
  }).map(({ task }) => task);
}
async function selectTaskId(prompt, tasks) {
  const candidates = selectableTasks(tasks);
  if (candidates.length === 0) throw new CliError("\u9078\u629E\u3067\u304D\u308B\u30BF\u30B9\u30AF\u306F\u3042\u308A\u307E\u305B\u3093\u3002");
  const selectedByFzf = await selectTaskIdWithFzf(prompt, candidates);
  if (selectedByFzf) return selectedByFzf;
  return selectTaskIdByNumber(prompt, candidates);
}
function selectableTasks(tasks) {
  return tasks.filter((task) => task.status !== "deleted");
}
function formatTaskChoice(task) {
  return `${task.id}	${task.status}	${task.branch}	${task.title}`;
}
async function confirmPrompt(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError("\u78BA\u8A8D\u30D7\u30ED\u30F3\u30D7\u30C8\u3092\u8868\u793A\u3067\u304D\u306A\u3044\u305F\u3081\u3001\u524A\u9664\u3092\u4E2D\u6B62\u3057\u307E\u3057\u305F\u3002");
  }
  const answer = await question(prompt);
  return ["y", "yes"].includes(answer.trim().toLowerCase());
}
function findTask(tasks, id) {
  const matches = tasks.filter((task) => task.id === id || task.id.startsWith(id));
  if (matches.length === 0) throw new CliError(`\u30BF\u30B9\u30AF\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093: ${id}`);
  if (matches.length > 1) throw new CliError(`\u30BF\u30B9\u30AFID\u304C\u66D6\u6627\u3067\u3059: ${id}`);
  return matches[0];
}
function updateTask(task, patch) {
  Object.assign(task, patch, { updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
}
function slugify(value) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || "task";
}
async function selectTaskIdWithFzf(prompt, tasks) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !await commandExists("fzf")) return void 0;
  const input = `${tasks.map(formatTaskChoice).join("\n")}
`;
  const selected = await execa4("fzf", ["--prompt", `${prompt}> `], {
    input,
    stderr: "inherit",
    reject: false
  });
  if (selected.failed) return void 0;
  const id = selected.stdout.trim().split("	")[0];
  return id || void 0;
}
async function selectTaskIdByNumber(prompt, tasks) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError("taskId \u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
  }
  console.log(prompt);
  tasks.forEach((task, index) => {
    console.log(`${index + 1}. ${formatTaskChoice(task)}`);
  });
  const answer = await question("\u756A\u53F7\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044: ");
  const selectedIndex = Number(answer.trim());
  if (!Number.isInteger(selectedIndex) || selectedIndex < 1 || selectedIndex > tasks.length) {
    throw new CliError("\u9078\u629E\u304C\u4E0D\u6B63\u3067\u3059\u3002");
  }
  return tasks[selectedIndex - 1].id;
}
async function question(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

// src/tmux.ts
import { execa as execa5 } from "execa";
function tmuxTargetForTask(task) {
  if (!task.tmuxSession) return "";
  if (!task.tmuxWindow) return task.tmuxSession;
  if (task.tmuxWindow.includes(":")) return task.tmuxWindow;
  return `${task.tmuxSession}:${task.tmuxWindow}`;
}
async function startTmuxTask(ctx, config, task, shellCommand) {
  if (process.env.TMUX) {
    const started2 = config.tmuxPanePlacement === "rightColumnPairs" ? await startRightColumnPairPane(ctx, task, shellCommand) : await splitTmuxPane(["split-window"], task, shellCommand);
    if (started2.failed) {
      throw new CliError(`tmux pane \u3092\u8D77\u52D5\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F: ${started2.stderr || started2.shortMessage}`);
    }
    const target = started2.stdout.trim().split("	")[0] ?? "";
    if (!target) {
      throw new CliError("\u4F5C\u6210\u3057\u305F tmux pane \u306E target \u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
    }
    return { session: target.split(":")[0], target, type: "pane" };
  }
  const session = tmuxSessionName(config, task.id);
  const started = await execa5("tmux", [
    "new-session",
    "-d",
    "-s",
    session,
    "-c",
    task.worktreePath,
    shellCommand
  ], { reject: false });
  if (started.failed) {
    throw new CliError(`tmux \u30BB\u30C3\u30B7\u30E7\u30F3\u3092\u8D77\u52D5\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F: ${started.stderr || started.shortMessage}`);
  }
  return { session, target: session, type: "session" };
}
async function tmuxTargetExists(task) {
  if (!task.tmuxSession) return false;
  const result = await execa5("tmux", ["display-message", "-p", "-t", tmuxTargetForTask(task), "#{session_name}:#{window_index}.#{pane_index}"], { reject: false });
  return !result.failed;
}
async function killTmuxTarget(task) {
  const target = tmuxTargetForTask(task);
  if (task.tmuxTargetType === "session") {
    await execa5("tmux", ["kill-session", "-t", target], { reject: false });
    return;
  }
  if (task.tmuxTargetType === "pane" || target.includes(".")) {
    await execa5("tmux", ["kill-pane", "-t", target], { reject: false });
    return;
  }
  if (task.tmuxTargetType === "window" || task.tmuxWindow) {
    await execa5("tmux", ["kill-window", "-t", target], { reject: false });
    return;
  }
  await execa5("tmux", ["kill-session", "-t", target], { reject: false });
}
function tmuxSessionName(config, id) {
  return `${config.tmuxSessionPrefix}-${id}`;
}
async function startRightColumnPairPane(ctx, task, shellCommand) {
  const current = await currentTmuxWindow();
  const layout = await loadTmuxLayout(ctx);
  const state = layout.windows[current.windowKey];
  if (state?.pendingTopPaneId && await tmuxPaneExists(state.pendingTopPaneId)) {
    const started2 = await splitTmuxPane(["split-window", "-v", "-t", state.pendingTopPaneId], task, shellCommand);
    if (!started2.failed) {
      layout.windows[current.windowKey] = { anchorPaneId: state.anchorPaneId };
      await saveTmuxLayout(ctx, layout);
    }
    return started2;
  }
  const anchorPaneId = state?.anchorPaneId && await tmuxPaneExists(state.anchorPaneId) ? state.anchorPaneId : current.paneId;
  const started = await splitTmuxPane(["split-window", "-h", "-t", anchorPaneId], task, shellCommand);
  if (!started.failed) {
    const paneId = started.stdout.trim().split("	")[1];
    layout.windows[current.windowKey] = {
      anchorPaneId,
      ...paneId ? { pendingTopPaneId: paneId } : {}
    };
    await saveTmuxLayout(ctx, layout);
  }
  return started;
}
async function splitTmuxPane(baseArgs, task, shellCommand) {
  return execa5("tmux", [
    ...baseArgs,
    "-P",
    "-F",
    "#{session_name}:#{window_index}.#{pane_index}	#{pane_id}",
    "-c",
    task.worktreePath,
    shellCommand
  ], { reject: false });
}
async function currentTmuxWindow() {
  const result = await execa5("tmux", ["display-message", "-p", "#{session_name}:#{window_index}	#{pane_id}"], { reject: false });
  if (result.failed) {
    throw new CliError(`\u73FE\u5728\u306E tmux window \u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F: ${result.stderr || result.shortMessage}`);
  }
  const [windowKey, paneId] = result.stdout.trim().split("	");
  if (!windowKey || !paneId) {
    throw new CliError("\u73FE\u5728\u306E tmux window \u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
  }
  return { windowKey, paneId };
}
async function tmuxPaneExists(paneId) {
  const result = await execa5("tmux", ["display-message", "-p", "-t", paneId, "#{pane_id}"], { reject: false });
  return !result.failed;
}

// src/commands.ts
var taskId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);
function buildProgram() {
  const program = new Command();
  program.name("wf").description("git worktree \u3068 tmux pane/session \u3067 AI \u30BF\u30B9\u30AF\u3092\u30ED\u30FC\u30AB\u30EB\u5B9F\u884C\u3059\u308B CLI\u3002").version("0.1.0", "-V, --version", "\u30D0\u30FC\u30B8\u30E7\u30F3\u756A\u53F7\u3092\u8868\u793A\u3057\u307E\u3059\u3002").helpOption("-h, --help", "\u30D8\u30EB\u30D7\u3092\u8868\u793A\u3057\u307E\u3059\u3002").addHelpCommand("help [command]", "\u30B3\u30DE\u30F3\u30C9\u306E\u30D8\u30EB\u30D7\u3092\u8868\u793A\u3057\u307E\u3059\u3002");
  program.command("create").argument("[title]", "\u30BF\u30B9\u30AF\u30BF\u30A4\u30C8\u30EB").option("--description <text>", "\u30BF\u30B9\u30AF\u306E\u8AAC\u660E").action(async (title, options) => {
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
    const worktreePath = path4.resolve(ctx.root, config.worktreeRoot, id);
    await git(ctx, ["branch", branch, "main"]);
    await git(ctx, ["worktree", "add", worktreePath, branch]);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const task = {
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
    console.log(`\u4F5C\u6210\u3057\u307E\u3057\u305F: ${id}`);
    console.log(`\u30D6\u30E9\u30F3\u30C1: ${branch}`);
    console.log(`worktree: ${worktreePath}`);
  });
  program.command("list").option("--all", "deleted \u3092\u542B\u3080\u3059\u3079\u3066\u306E\u30BF\u30B9\u30AF\u3092\u8868\u793A\u3057\u307E\u3059").description("\u30BF\u30B9\u30AF\u4E00\u89A7\u3092\u8868\u793A\u3057\u307E\u3059\u3002").action(async (options) => {
    const ctx = await loadRepoContext();
    await ensureInitialized(ctx);
    const tasks = await loadTasks(ctx);
    const listedTasks = visibleTasks(tasks.tasks, Boolean(options.all));
    if (listedTasks.length === 0) {
      console.log("\u30BF\u30B9\u30AF\u306F\u3042\u308A\u307E\u305B\u3093\u3002");
      return;
    }
    for (const task of listedTasks) {
      console.log(`${task.createdAt}	${task.id}	${task.status}	${task.branch}	${task.title}`);
    }
  });
  program.command("status").argument("[taskId]", "\u30BF\u30B9\u30AFID").description("\u30BF\u30B9\u30AF\u8A73\u7D30\u3068 tmux \u306E\u72B6\u614B\u3092\u8868\u793A\u3057\u307E\u3059\u3002").action(async (id) => {
    const ctx = await loadRepoContext();
    await ensureInitialized(ctx);
    const tasks = await loadTasks(ctx);
    if (!id) {
      for (const task2 of tasks.tasks) {
        console.log(`${task2.id}	${task2.status}	${task2.title}`);
      }
      return;
    }
    const task = findTask(tasks.tasks, id);
    console.log(`ID: ${task.id}`);
    console.log(`\u30BF\u30A4\u30C8\u30EB: ${task.title}`);
    if (task.description) console.log(`\u8AAC\u660E: ${task.description}`);
    console.log(`\u72B6\u614B: ${task.status}`);
    console.log(`\u30D6\u30E9\u30F3\u30C1: ${task.branch}`);
    console.log(`worktree: ${task.worktreePath}`);
    if (task.agent) console.log(`\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8: ${task.agent}`);
    if (task.tmuxSession) {
      const target = tmuxTargetForTask(task);
      const alive = await tmuxTargetExists(task);
      console.log(`tmux: ${target} (${alive ? "\u5B58\u5728\u3057\u307E\u3059" : "\u898B\u3064\u304B\u308A\u307E\u305B\u3093"})`);
    }
  });
  program.command("run").argument("[taskId]", "\u30BF\u30B9\u30AFID").option("--agent <agent>", `\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8 adapter: ${formatSupportedAgents()}`).description("\u30BF\u30B9\u30AF\u7528\u306E\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u3092 tmux \u3067\u8D77\u52D5\u3057\u307E\u3059\u3002").action(async (id, options) => {
    const taskId2 = id ?? await selectTaskIdFromRepo("\u5B9F\u884C\u3059\u308B\u30BF\u30B9\u30AF\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044");
    await runTask(taskId2, options.agent, false);
  });
  program.command("stop").argument("<taskId>", "\u30BF\u30B9\u30AFID").description("\u5B9F\u884C\u4E2D\u306E\u30BF\u30B9\u30AF\u3092\u505C\u6B62\u3057\u307E\u3059\u3002").action(async (id) => {
    const ctx = await loadRepoContext();
    await ensureInitialized(ctx);
    const tasks = await loadTasks(ctx);
    const task = findTask(tasks.tasks, id);
    if (await tmuxTargetExists(task)) {
      await execa6("tmux", ["send-keys", "-t", tmuxTargetForTask(task), "C-c"]);
    }
    updateTask(task, { status: "stopped" });
    await saveTasks(ctx, tasks);
    console.log(`\u505C\u6B62\u3057\u307E\u3057\u305F: ${task.id}`);
  });
  program.command("resume").argument("<taskId>", "\u30BF\u30B9\u30AFID").description("\u505C\u6B62\u3057\u305F\u30BF\u30B9\u30AF\u306E\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u3092\u518D\u8D77\u52D5\u3057\u307E\u3059\u3002").action(async (id) => {
    await runTask(id, void 0, true);
  });
  program.command("diff").argument("<taskId>", "\u30BF\u30B9\u30AFID").description("\u30BF\u30B9\u30AF worktree \u306E\u5DEE\u5206\u3092\u8868\u793A\u3057\u3066\u4FDD\u5B58\u3057\u307E\u3059\u3002").action(async (id) => {
    const ctx = await loadRepoContext();
    await ensureInitialized(ctx);
    const tasks = await loadTasks(ctx);
    const task = findTask(tasks.tasks, id);
    const diff = await gitAt(task.worktreePath, ["diff"], { reject: false });
    const stdout = typeof diff.stdout === "string" ? diff.stdout : "";
    const diffPath = path4.join(ctx.workforgeDir, DIFFS_DIR, `${task.id}.patch`);
    await writeFile3(diffPath, stdout, "utf8");
    updateTask(task, { status: "review" });
    await saveTasks(ctx, tasks);
    process.stdout.write(stdout);
    console.error(`\u5DEE\u5206\u3092\u4FDD\u5B58\u3057\u307E\u3057\u305F: ${diffPath}`);
  });
  program.command("comment").argument("<taskId>", "\u30BF\u30B9\u30AFID").argument("<text>", "\u30B3\u30E1\u30F3\u30C8\u672C\u6587").description("\u30BF\u30B9\u30AF\u30B3\u30E1\u30F3\u30C8\u3092\u8FFD\u8A18\u3057\u307E\u3059\u3002").action(async (id, text) => {
    const ctx = await loadRepoContext();
    await ensureInitialized(ctx);
    const tasks = await loadTasks(ctx);
    const task = findTask(tasks.tasks, id);
    const commentPath = path4.join(ctx.workforgeDir, COMMENTS_DIR, `${task.id}.jsonl`);
    const record = JSON.stringify({ taskId: task.id, text, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
    await appendFile(commentPath, `${record}
`, "utf8");
    console.log(`\u30B3\u30E1\u30F3\u30C8\u3092\u8FFD\u52A0\u3057\u307E\u3057\u305F: ${task.id}`);
  });
  program.command("log").argument("<taskId>", "\u30BF\u30B9\u30AFID").description("\u4FDD\u5B58\u6E08\u307F\u306E tmux \u30ED\u30B0\u3092\u8868\u793A\u3057\u307E\u3059\u3002").action(async (id) => {
    const ctx = await loadRepoContext();
    await ensureInitialized(ctx);
    const tasks = await loadTasks(ctx);
    const task = findTask(tasks.tasks, id);
    const logPath = path4.join(ctx.workforgeDir, LOGS_DIR, `${task.id}.log`);
    try {
      process.stdout.write(await readFile3(logPath, "utf8"));
    } catch {
      throw new CliError(`\u30BF\u30B9\u30AF ${task.id} \u306E\u30ED\u30B0\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002`);
    }
  });
  program.command("delete").argument("[taskId]", "\u30BF\u30B9\u30AFID").option("--force", "git worktree \u306E\u524A\u9664\u3092\u5F37\u5236\u3057\u307E\u3059").option("--all", "\u672A\u524A\u9664\u306E\u30BF\u30B9\u30AF\u3092\u3059\u3079\u3066\u524A\u9664\u3057\u307E\u3059").description("\u30BF\u30B9\u30AF worktree \u3092\u524A\u9664\u3057\u3001\u72B6\u614B\u3092 deleted \u306B\u3057\u307E\u3059\u3002").action(async (id, options) => {
    const ctx = await loadRepoContext();
    await ensureInitialized(ctx);
    const tasks = await loadTasks(ctx);
    if (options.all && id) {
      throw new CliError("--all \u3068 taskId \u306F\u540C\u6642\u306B\u6307\u5B9A\u3067\u304D\u307E\u305B\u3093\u3002");
    }
    if (options.all) {
      const targets = selectableTasks(tasks.tasks);
      if (targets.length === 0) throw new CliError("\u524A\u9664\u5BFE\u8C61\u306E\u30BF\u30B9\u30AF\u306F\u3042\u308A\u307E\u305B\u3093\u3002");
      console.log("\u524A\u9664\u5BFE\u8C61:");
      for (const task2 of targets) {
        console.log(formatTaskChoice(task2));
      }
      if (!await confirmPrompt(`${targets.length} \u4EF6\u306E\u30BF\u30B9\u30AF\u3092\u3059\u3079\u3066\u524A\u9664\u3057\u307E\u3059\u304B? [y/N] `)) {
        console.log("\u524A\u9664\u3092\u4E2D\u6B62\u3057\u307E\u3057\u305F\u3002");
        return;
      }
      for (const task2 of targets) {
        await deleteTask(ctx, task2, { force: options.force });
        await saveTasks(ctx, tasks);
        console.log(`\u524A\u9664\u3057\u307E\u3057\u305F: ${task2.id}`);
      }
      return;
    }
    const taskId2 = id ?? await selectTaskId("\u524A\u9664\u3059\u308B\u30BF\u30B9\u30AF\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044", tasks.tasks);
    const task = findTask(tasks.tasks, taskId2);
    await deleteTask(ctx, task, { force: options.force });
    await saveTasks(ctx, tasks);
    console.log(`\u524A\u9664\u3057\u307E\u3057\u305F: ${task.id}`);
  });
  return program;
}
async function runTask(id, agentOption, isResume) {
  const ctx = await loadRepoContext();
  await ensureInitialized(ctx);
  await ensureCommand("tmux", "\u30BF\u30B9\u30AF\u3092\u5B9F\u884C\u3059\u308B\u306B\u306F tmux \u304C\u5FC5\u8981\u3067\u3059\u3002");
  const config = await loadConfig(ctx);
  const tasks = await loadTasks(ctx);
  const task = findTask(tasks.tasks, id);
  if (task.status === "deleted") throw new CliError(`\u30BF\u30B9\u30AF ${task.id} \u306F\u524A\u9664\u6E08\u307F\u3067\u3059\u3002`);
  const agent = resolveAgent(agentOption, config);
  const adapter = buildAgentAdapter(agent, isResume);
  await ensureCommand(adapter.command, `${agent} adapter \u3092\u4F7F\u3046\u306B\u306F ${adapter.command} \u304C\u5FC5\u8981\u3067\u3059\u3002`);
  const logPath = path4.join(ctx.workforgeDir, LOGS_DIR, `${task.id}.log`);
  const prompt = buildAgentPrompt(task, isResume);
  const shellCommand = buildTmuxShellCommand(adapter, prompt, logPath, config.keepPaneOnDone);
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
  console.log(`${isResume ? "\u518D\u958B\u3057\u307E\u3057\u305F" : "\u5B9F\u884C\u3092\u958B\u59CB\u3057\u307E\u3057\u305F"}: ${task.id}`);
  console.log(`tmux: ${tmuxTarget.target}`);
  console.log(`\u30ED\u30B0: ${logPath}`);
}
async function selectTaskIdFromRepo(prompt) {
  const ctx = await loadRepoContext();
  await ensureInitialized(ctx);
  return selectTaskId(prompt, (await loadTasks(ctx)).tasks);
}
async function deleteTask(ctx, task, options) {
  if (await tmuxTargetExists(task)) {
    await killTmuxTarget(task);
  }
  const args = ["worktree", "remove"];
  if (options.force) args.push("--force");
  args.push(task.worktreePath);
  const removal = await git(ctx, args, { reject: false });
  if (removal.failed && !options.force) {
    throw new CliError(`worktree \u3092\u524A\u9664\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u610F\u56F3\u3057\u305F\u524A\u9664\u306A\u3089 --force \u3092\u4ED8\u3051\u3066\u518D\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002
${removal.stderr}`);
  }
  if (removal.failed) {
    await rm2(task.worktreePath, { recursive: true, force: true });
  }
  updateTask(task, { status: "deleted" });
}

// src/cli.ts
async function main() {
  try {
    await buildProgram().parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CliError) {
      console.error(`wf: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
main();
