// Наполняет dev-библиотеку курсами:
//   pnpm dev:seed [--user-data <каталог>]
// Копирует в `<userData>/library` образцовый SQL-курс (фикстура движка) и
// курсы из `apps/desktop/dev-library` (проверяемый SQL `sql_analytics`, а также
// Git, HTTP с самооценкой). Повторный
// запуск перезаписывает эти файлы, чужие курсы в библиотеке не трогает.
// Приложение подхватит курсы при следующем запуске или по «Настройки →
// Библиотека → Перечитать».
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveUserData } from './lib/user-data.mjs';

const sources = [
  '../../../packages/engine/test/fixtures/libraries/sql-course/lib_kb',
  '../dev-library',
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

const library = join(resolveUserData(process.argv.slice(2)), 'library');
await mkdir(library, { recursive: true });
for (const source of sources) {
  await cp(source, library, { recursive: true, force: true });
}

const courses = (await readdir(library, { withFileTypes: true }))
  .filter(
    (entry) =>
      entry.isDirectory() &&
      existsSync(join(library, entry.name, 'course_manifest.json')),
  )
  .map((entry) => entry.name);
console.log(`seed: ${library}`);
console.log(`seed: courses ${courses.join(', ')}`);
