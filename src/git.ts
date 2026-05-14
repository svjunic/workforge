import { execa, type Options } from "execa";
import path from "node:path";

import { WORKFORGE_DIR } from "./constants.js";
import { CliError } from "./errors.js";
import type { RepoContext } from "./types.js";

export async function loadRepoContext(): Promise<RepoContext> {
  const result = await execa("git", ["rev-parse", "--show-toplevel"], { reject: false });
  if (result.failed) throw new CliError("wf は git リポジトリ内で実行してください。");
  const root = result.stdout.trim();
  return { root, workforgeDir: path.join(root, WORKFORGE_DIR) };
}

export async function ensureInitialCommit(ctx: RepoContext) {
  const result = await git(ctx, ["rev-parse", "--verify", "HEAD"], { reject: false });
  if (result.failed) throw new CliError("このリポジトリには初期コミットがありません。");
}

export async function ensureBaseBranch(ctx: RepoContext, branch: string) {
  const result = await git(ctx, ["rev-parse", "--verify", branch], { reject: false });
  if (result.failed) throw new CliError(`ベースブランチ '${branch}' が存在しません。`);
}

export async function git(ctx: RepoContext, args: string[], options: Options = {}) {
  return execa("git", ["-C", ctx.root, ...args], options);
}

export async function gitAt(cwd: string, args: string[], options: Options = {}) {
  return execa("git", ["-C", cwd, ...args], options);
}
