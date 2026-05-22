import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";

import type { RepoContext } from "./types.js";

const LOCAL_AI_SETTING_PATHS = [
  "AGENTS.local.md",
  "CLAUDE.local.md",
  "CONVENTIONS.md",
  "settings.local.json",
  ".codex",
  ".opencode",
  ".aider.conf.yml",
  ".aider.conf.yaml",
  ".aiderignore",
  ".claude/skills",
  ".claude/agents",
  ".claude/rules",
  ".claude/docs",
  ".claude/commands",
  ".github/copilot-instructions.md",
  ".github/instructions"
] as const;

export async function copyLocalAiSettings(ctx: RepoContext, worktreePath: string) {
  for (const relativePath of LOCAL_AI_SETTING_PATHS) {
    const source = path.join(ctx.root, relativePath);
    if (!await exists(source)) continue;

    const destination = path.join(worktreePath, relativePath);
    if (await exists(destination)) continue;

    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, {
      recursive: true,
      force: false,
      errorOnExist: false
    });
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
