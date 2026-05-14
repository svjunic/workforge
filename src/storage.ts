import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  COMMENTS_DIR,
  CONFIG_FILE,
  DIFFS_DIR,
  LOGS_DIR,
  TASKS_FILE,
  TMUX_LAYOUT_FILE,
  WORKTREES_DIR
} from "./constants.js";
import { CliError } from "./errors.js";
import { ConfigSchema, TasksSchema, TmuxLayoutSchema } from "./schemas.js";
import { ensureCreateTemplate } from "./template.js";
import type { Config, RepoContext, TasksFile, TmuxLayout } from "./types.js";

export async function ensureInitialized(ctx: RepoContext) {
  await mkdir(ctx.workforgeDir, { recursive: true });
  await mkdir(path.join(ctx.workforgeDir, LOGS_DIR), { recursive: true });
  await mkdir(path.join(ctx.workforgeDir, COMMENTS_DIR), { recursive: true });
  await mkdir(path.join(ctx.workforgeDir, DIFFS_DIR), { recursive: true });
  await mkdir(path.join(ctx.workforgeDir, WORKTREES_DIR), { recursive: true });

  const configPath = path.join(ctx.workforgeDir, CONFIG_FILE);
  const tasksPath = path.join(ctx.workforgeDir, TASKS_FILE);

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

  await ensureCreateTemplate(ctx);
}

export async function loadConfig(ctx: RepoContext): Promise<Config> {
  const configPath = path.join(ctx.workforgeDir, CONFIG_FILE);
  try {
    return ConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new CliError(`${path.relative(ctx.root, configPath)} が不正です: ${error.message}`);
    }
    throw new CliError(`${path.relative(ctx.root, configPath)} を読み込めませんでした。`);
  }
}

export async function loadTasks(ctx: RepoContext): Promise<TasksFile> {
  const tasksPath = path.join(ctx.workforgeDir, TASKS_FILE);
  try {
    return TasksSchema.parse(JSON.parse(await readFile(tasksPath, "utf8")));
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new CliError(`${path.relative(ctx.root, tasksPath)} が不正です: ${error.message}`);
    }
    throw new CliError(`${path.relative(ctx.root, tasksPath)} を読み込めませんでした。`);
  }
}

export async function saveTasks(ctx: RepoContext, tasks: TasksFile) {
  await writeJson(path.join(ctx.workforgeDir, TASKS_FILE), TasksSchema.parse(tasks));
}

export async function loadTmuxLayout(ctx: RepoContext): Promise<TmuxLayout> {
  const layoutPath = path.join(ctx.workforgeDir, TMUX_LAYOUT_FILE);
  try {
    return TmuxLayoutSchema.parse(JSON.parse(await readFile(layoutPath, "utf8")));
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new CliError(`${path.relative(ctx.root, layoutPath)} が不正です: ${error.message}`);
    }
    return { windows: {} };
  }
}

export async function saveTmuxLayout(ctx: RepoContext, layout: TmuxLayout) {
  await writeJson(path.join(ctx.workforgeDir, TMUX_LAYOUT_FILE), TmuxLayoutSchema.parse(layout));
}

export async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function defaultConfig(): Config {
  return {
    defaultAgent: "claude",
    worktreeRoot: ".workforge/worktrees",
    tmuxSessionPrefix: "workforge",
    keepPaneOnDone: true,
    tmuxPanePlacement: "rightColumnPairs"
  };
}
