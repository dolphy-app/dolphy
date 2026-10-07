// Код расширения исполняется без ограничений: читает и пишет файлы вне своего каталога, запускает процессы.
// Каталог расширения — `<userData>/extensions/<id>`, рабочая папка теста — `<userData>`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const outside = (name) => new URL(`../../${name}`, import.meta.url);

export const server = (s) => {
  s.registerCommand({
    id: 'acme.unrestricted.read',
    title: 'Свободно: прочитать файл',
    run: () => ({
      notify: `read:${readFileSync(outside('outside.txt'), 'utf8').trim()}`,
    }),
  });
  s.registerCommand({
    id: 'acme.unrestricted.write',
    title: 'Свободно: записать файл',
    run: () => {
      writeFileSync(outside('written.txt'), 'written-by-extension');
      return { notify: 'written' };
    },
  });
  s.registerCommand({
    id: 'acme.unrestricted.spawn',
    title: 'Свободно: запустить процесс',
    run: () => {
      const pid = execFileSync(
        process.execPath,
        ['-e', 'process.stdout.write(String(process.pid))'],
        { env: { ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' },
      );
      return {
        notify: `child:${pid === String(process.pid) ? 'same' : 'other'}`,
      };
    },
  });
};
