// Копирует манифест и схемы расширения рядом с собранными бандлами.
import { cpSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = `${root}extension-src`;
for (const id of readdirSync(src)) {
  cpSync(`${src}/${id}`, `${root}dist-ext`, { recursive: true });
}
