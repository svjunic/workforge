import { execa } from "execa";

import { CliError } from "./errors.js";

export async function ensureCommand(command: string, message: string) {
  const result = await execa("command", ["-v", command], { shell: true, reject: false });
  if (result.failed || !result.stdout.trim()) throw new CliError(message);
}

export async function commandExists(command: string): Promise<boolean> {
  const result = await execa("command", ["-v", command], { shell: true, reject: false });
  return !result.failed && Boolean(result.stdout.trim());
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
