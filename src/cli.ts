#!/usr/bin/env node

import { buildProgram } from "./commands.js";
import { CliError } from "./errors.js";

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
