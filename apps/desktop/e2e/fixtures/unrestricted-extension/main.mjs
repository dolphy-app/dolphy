// Код расширения исполняется без ограничений: читает и пишет файлы вне своего каталога, запускает процессы.
// Каталог расширения — `<userData>/extensions/<id>`, рабочая папка теста — `<userData>`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const outside = (name) => new URL(`../../${name}`, import.meta.url);

export default {
  activate(ctx) {
    ctx.commands.register('acme.unrestricted.read', () => ({
      notify: `read:${readFileSync(outside('outside.txt'), 'utf8').trim()}`,
    }));
    ctx.commands.register('acme.unrestricted.write', () => {
      writeFileSync(outside('written.txt'), 'written-by-extension');
      return { notify: 'written' };
    });
    ctx.commands.register('acme.unrestricted.spawn', () => {
      const pid = execFileSync(
        process.execPath,
        ['-e', 'process.stdout.write(String(process.pid))'],
        { env: { ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' },
      );
      return { notify: `child:${pid === String(process.pid) ? 'same' : 'other'}` };
    });
  },
};
