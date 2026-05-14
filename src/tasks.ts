import { execa } from "execa";
import { createInterface } from "node:readline/promises";

import { CliError } from "./errors.js";
import { commandExists } from "./system.js";
import type { Task } from "./types.js";

export function visibleTasks(tasks: Task[], includeDeleted: boolean): Task[] {
  return (includeDeleted ? tasks : tasks.filter((task) => task.status !== "deleted"))
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const byCreatedAt = b.task.createdAt.localeCompare(a.task.createdAt);
      return byCreatedAt || a.index - b.index;
    })
    .map(({ task }) => task);
}

export async function selectTaskId(prompt: string, tasks: Task[]): Promise<string> {
  const candidates = selectableTasks(tasks);
  if (candidates.length === 0) throw new CliError("選択できるタスクはありません。");

  const selectedByFzf = await selectTaskIdWithFzf(prompt, candidates);
  if (selectedByFzf) return selectedByFzf;

  return selectTaskIdByNumber(prompt, candidates);
}

export function selectableTasks(tasks: Task[]): Task[] {
  return tasks.filter((task) => task.status !== "deleted");
}

export function formatTaskChoice(task: Task): string {
  return `${task.id}\t${task.status}\t${task.branch}\t${task.title}`;
}

export async function confirmPrompt(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError("確認プロンプトを表示できないため、削除を中止しました。");
  }

  const answer = await question(prompt);
  return ["y", "yes"].includes(answer.trim().toLowerCase());
}

export function findTask(tasks: Task[], id: string): Task {
  const matches = tasks.filter((task) => task.id === id || task.id.startsWith(id));
  if (matches.length === 0) throw new CliError(`タスクが見つかりません: ${id}`);
  if (matches.length > 1) throw new CliError(`タスクIDが曖昧です: ${id}`);
  return matches[0]!;
}

export function updateTask(task: Task, patch: Partial<Task>) {
  Object.assign(task, patch, { updatedAt: new Date().toISOString() });
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "task";
}

async function selectTaskIdWithFzf(prompt: string, tasks: Task[]): Promise<string | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !await commandExists("fzf")) return undefined;

  const input = `${tasks.map(formatTaskChoice).join("\n")}\n`;
  const selected = await execa("fzf", ["--prompt", `${prompt}> `], {
    input,
    stderr: "inherit",
    reject: false
  });
  if (selected.failed) return undefined;

  const id = selected.stdout.trim().split("\t")[0];
  return id || undefined;
}

async function selectTaskIdByNumber(prompt: string, tasks: Task[]): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError("taskId を指定してください。");
  }

  console.log(prompt);
  tasks.forEach((task, index) => {
    console.log(`${index + 1}. ${formatTaskChoice(task)}`);
  });

  const answer = await question("番号を入力してください: ");
  const selectedIndex = Number(answer.trim());
  if (!Number.isInteger(selectedIndex) || selectedIndex < 1 || selectedIndex > tasks.length) {
    throw new CliError("選択が不正です。");
  }

  return tasks[selectedIndex - 1]!.id;
}

async function question(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}
