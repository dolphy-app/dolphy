import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** Служебное и зависимости не относятся к коду расширения (так же судит наблюдатель режима разработчика). */
const isIgnored = (name: string): boolean =>
  name.startsWith('.') || name === 'node_modules';

const collect = async (
  root: string,
  relative: string,
  lines: string[],
): Promise<void> => {
  const entries = await readdir(path.join(root, relative), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (isIgnored(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      await collect(root, child, lines);
      continue;
    }
    // файл или ссылка на файл; пропавший между чтением каталога и stat — не ошибка
    const info = await stat(path.join(root, child)).catch(() => null);
    if (info?.isFile() === true) {
      lines.push(`${child}\0${info.size}\0${info.mtimeMs}`);
    }
  }
};

/**
 * Отпечаток содержимого каталога расширения: относительные пути, размеры и
 * времена изменения файлов. Меняется при правке любого файла (в том числе при
 * неизменной версии), поэтому хост расширений по нему отличает «то же самое»
 * от «изменилось» и перезагружает код.
 */
export const fingerprintDir = async (dir: string): Promise<string> => {
  const lines: string[] = [];
  await collect(dir, '', lines);
  return createHash('sha1').update(lines.sort().join('\n')).digest('hex');
};
