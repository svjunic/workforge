import { execa } from "execa";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CREATE_TEMPLATE_FILE } from "./constants.js";
import { CliError } from "./errors.js";
import type { CreateInput, RepoContext, Task } from "./types.js";

export async function ensureCreateTemplate(ctx: RepoContext) {
  const templatePath = userCreateTemplatePath(ctx);
  try {
    await readFile(templatePath, "utf8");
  } catch {
    await mkdir(path.dirname(templatePath), { recursive: true });
    await writeFile(templatePath, await readDefaultCreateTemplate(), "utf8");
  }
}

export async function resolveCreateInput(ctx: RepoContext, title: string | undefined, options: { description?: string }): Promise<CreateInput> {
  if (title) {
    return { title, description: options.description };
  }
  if (options.description) {
    throw new CliError("title を省略してエディタ入力する場合、--description は指定できません。");
  }

  const description = await editCreateTemplate(ctx);
  if (!description.trim()) {
    throw new CliError("タスク本文が空です。");
  }

  const extractedTitle = extractMarkdownTitle(description);
  if (!extractedTitle) {
    throw new CliError("タスク本文の最初の Markdown H1 を title として入力してください。");
  }

  return { title: extractedTitle, description };
}

export async function resolveTaskEditInput(task: Task): Promise<CreateInput> {
  const description = await editTaskMarkdown(task);
  if (!description.trim()) {
    throw new CliError("タスク本文が空です。");
  }

  const extractedTitle = extractMarkdownTitle(description);
  if (!extractedTitle) {
    throw new CliError("タスク本文の最初の Markdown H1 を title として入力してください。");
  }

  return { title: extractedTitle, description };
}

export function userCreateTemplatePath(ctx: RepoContext): string {
  return path.join(ctx.workforgeDir, CREATE_TEMPLATE_FILE);
}

export async function readDefaultCreateTemplate(): Promise<string> {
  return readFile(defaultCreateTemplatePath(), "utf8");
}

function defaultCreateTemplatePath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "..", "templates", "create.md");
}

async function editCreateTemplate(ctx: RepoContext): Promise<string> {
  const editor = process.env.VISUAL || process.env.EDITOR;
  if (!editor) {
    throw new CliError("title を省略する場合は VISUAL または EDITOR を設定してください。");
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "workforge-create-"));
  const tempPath = path.join(tempDir, "task.md");
  await writeFile(tempPath, await readFile(userCreateTemplatePath(ctx), "utf8"), "utf8");

  try {
    const result = await execa(editor, [tempPath], { stdio: "inherit", reject: false });
    if (result.failed) {
      throw new CliError(`エディタを終了できませんでした: ${result.shortMessage}`);
    }
    return await readFile(tempPath, "utf8");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function editTaskMarkdown(task: Task): Promise<string> {
  const editor = process.env.VISUAL || process.env.EDITOR;
  if (!editor) {
    throw new CliError("タスクを編集するには VISUAL または EDITOR を設定してください。");
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "workforge-edit-"));
  const tempPath = path.join(tempDir, "task.md");
  await writeFile(tempPath, taskEditMarkdown(task), "utf8");

  try {
    const result = await execa(editor, [tempPath], { stdio: "inherit", reject: false });
    if (result.failed) {
      throw new CliError(`エディタを終了できませんでした: ${result.shortMessage}`);
    }
    return await readFile(tempPath, "utf8");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function taskEditMarkdown(task: Task): string {
  if (task.description && extractMarkdownTitle(task.description)) return task.description;
  const body = task.description?.trim();
  return body ? `# ${task.title}\n\n${body}\n` : `# ${task.title}\n`;
}

function extractMarkdownTitle(markdown: string): string | undefined {
  const h1 = markdown.split(/\r?\n/).find((line) => line.startsWith("# ") && line.slice(2).trim());
  return h1?.slice(2).trim();
}
