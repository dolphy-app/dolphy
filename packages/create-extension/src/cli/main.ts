#!/usr/bin/env node
import { runCli } from './run.ts';

// `pnpm -F ... create-extension` запускает скрипт в каталоге пакета;
// INIT_CWD хранит каталог, откуда пользователь вызвал pnpm
process.exitCode = await runCli(
  process.argv.slice(2),
  {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
  process.env['INIT_CWD'] ?? process.cwd(),
);
