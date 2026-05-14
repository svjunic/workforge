import { execa } from "execa";

import { CliError } from "./errors.js";
import { loadTmuxLayout, saveTmuxLayout } from "./storage.js";
import type { Config, RepoContext, Task } from "./types.js";

export function tmuxTargetForTask(task: Task): string {
  if (!task.tmuxSession) return "";
  if (!task.tmuxWindow) return task.tmuxSession;
  if (task.tmuxWindow.includes(":")) return task.tmuxWindow;
  return `${task.tmuxSession}:${task.tmuxWindow}`;
}

export async function startTmuxTask(ctx: RepoContext, config: Config, task: Task, shellCommand: string): Promise<{ session: string; target: string; type: "session" | "pane" }> {
  if (process.env.TMUX) {
    const started = config.tmuxPanePlacement === "rightColumnPairs"
      ? await startRightColumnPairPane(ctx, task, shellCommand)
      : await splitTmuxPane(["split-window"], task, shellCommand);
    if (started.failed) {
      throw new CliError(`tmux pane を起動できませんでした: ${started.stderr || started.shortMessage}`);
    }

    const target = started.stdout.trim().split("\t")[0] ?? "";
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

export async function tmuxTargetExists(task: Task): Promise<boolean> {
  if (!task.tmuxSession) return false;
  const result = await execa("tmux", ["display-message", "-p", "-t", tmuxTargetForTask(task), "#{session_name}:#{window_index}.#{pane_index}"], { reject: false });
  return !result.failed;
}

export async function killTmuxTarget(task: Task) {
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

function tmuxSessionName(config: Config, id: string): string {
  return `${config.tmuxSessionPrefix}-${id}`;
}

async function startRightColumnPairPane(ctx: RepoContext, task: Task, shellCommand: string) {
  const current = await currentTmuxWindow();
  const layout = await loadTmuxLayout(ctx);
  const state = layout.windows[current.windowKey];

  if (state?.pendingTopPaneId && await tmuxPaneExists(state.pendingTopPaneId)) {
    const started = await splitTmuxPane(["split-window", "-v", "-t", state.pendingTopPaneId], task, shellCommand);
    if (!started.failed) {
      layout.windows[current.windowKey] = { anchorPaneId: state.anchorPaneId };
      await saveTmuxLayout(ctx, layout);
    }
    return started;
  }

  const anchorPaneId = state?.anchorPaneId && await tmuxPaneExists(state.anchorPaneId)
    ? state.anchorPaneId
    : current.paneId;
  const started = await splitTmuxPane(["split-window", "-h", "-t", anchorPaneId], task, shellCommand);
  if (!started.failed) {
    const paneId = started.stdout.trim().split("\t")[1];
    layout.windows[current.windowKey] = {
      anchorPaneId,
      ...(paneId ? { pendingTopPaneId: paneId } : {})
    };
    await saveTmuxLayout(ctx, layout);
  }
  return started;
}

async function splitTmuxPane(baseArgs: string[], task: Task, shellCommand: string) {
  return execa("tmux", [
    ...baseArgs,
    "-P",
    "-F",
    "#{session_name}:#{window_index}.#{pane_index}\t#{pane_id}",
    "-c",
    task.worktreePath,
    shellCommand
  ], { reject: false });
}

async function currentTmuxWindow(): Promise<{ windowKey: string; paneId: string }> {
  const result = await execa("tmux", ["display-message", "-p", "#{session_name}:#{window_index}\t#{pane_id}"], { reject: false });
  if (result.failed) {
    throw new CliError(`現在の tmux window を取得できませんでした: ${result.stderr || result.shortMessage}`);
  }
  const [windowKey, paneId] = result.stdout.trim().split("\t");
  if (!windowKey || !paneId) {
    throw new CliError("現在の tmux window を取得できませんでした。");
  }
  return { windowKey, paneId };
}

async function tmuxPaneExists(paneId: string): Promise<boolean> {
  const result = await execa("tmux", ["display-message", "-p", "-t", paneId, "#{pane_id}"], { reject: false });
  return !result.failed;
}
