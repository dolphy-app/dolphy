#!/usr/bin/env node
import { runCli } from './run.ts';

// `pnpm -F ... create-extension` runs the script in the package directory;
// INIT_CWD holds the directory the user invoked pnpm from
process.exitCode = await runCli(
  process.argv.slice(2),
  {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
  process.env['INIT_CWD'] ?? process.cwd(),
);
