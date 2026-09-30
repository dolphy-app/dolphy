import {
  chmod,
  mkdir,
  readdir,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import type {
  SavedFilterDto,
  StudySessionWire,
} from '@spirula/engine-contract';
import { describe, expect, it } from 'vitest';
import {
  canonicalFileName,
  createJsonSettingsStore,
  SettingsStoreError,
} from '../../src/node/json-settings-store.ts';
import { useTmpDirs, writeFiles } from '../helpers/tmp.ts';

const tmp = useTmpDirs();
const posixPermissions =
  process.platform !== 'win32' && process.getuid?.() !== 0;

const filter = (id: string, description = `d-${id}`): SavedFilterDto => ({
  id,
  description,
  filter: { CourseFilter: { course_ids: [id] } },
});
const session = (id: string): StudySessionWire => ({
  id,
  description: `d-${id}`,
  parts: [{ NoFilter: { duration: 10 } }],
});
const wire = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const open = async () => {
  const dir = await tmp.make('settings-');
  return { dir, store: createJsonSettingsStore({ dir }) };
};

describe('filter_manager', () => {
  it('list отсортирован по id, значения равны сохранённым', async () => {
    const { store } = await open();
    await store.saveFilter(filter('b'));
    await store.saveFilter(filter('a'));
    expect(await store.listFilters()).toEqual([filter('a'), filter('b')]);
  });

  it('читает файлы с произвольными именами, id — из содержимого', async () => {
    const { dir, store } = await open();
    await writeFiles(dir, {
      'filters/x_123.json': wire(filter('zzz')),
      'filters/y.json': wire(filter('aaa')),
    });
    expect((await store.listFilters()).map((f) => f.id)).toEqual([
      'aaa',
      'zzz',
    ]);
  });

  it('filters_repeated_ids: один id в трёх файлах — ошибка', async () => {
    const { dir, store } = await open();
    await writeFiles(dir, {
      'filters/1.json': wire(filter('same')),
      'filters/2.json': wire(filter('same')),
      'filters/3.json': wire(filter('same')),
    });
    await expect(store.listFilters()).rejects.toThrow(SettingsStoreError);
    await expect(store.listFilters()).rejects.toThrow(/duplicate id "same"/);
  });

  it('read_bad_directory: нет каталога — пустой список', async () => {
    const { store } = await open();
    expect(await store.listFilters()).toEqual([]);
    expect(await store.listSessions()).toEqual([]);
  });

  it('read_bad_file_format: битый JSON — ошибка с именем файла', async () => {
    const { dir, store } = await open();
    await writeFiles(dir, { 'filters/bad.json': '"bad json"x' });
    const error = await store.listFilters().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SettingsStoreError);
    const { path, message, cause } = error as SettingsStoreError;
    expect(path).toBe(join(dir, 'filters', 'bad.json'));
    expect(message).toContain('bad.json');
    expect(cause).toBeInstanceOf(SyntaxError);
  });

  it('невалидная схема — ошибка с путём поля', async () => {
    const { dir, store } = await open();
    await writeFiles(dir, {
      'filters/nodesc.json': wire({ id: 'f', filter: 'ReviewListFilter' }),
    });
    await expect(store.listFilters()).rejects.toThrow(
      /nodesc\.json.*description/,
    );
  });

  it.skipIf(!posixPermissions)(
    'read_bad_file_permissions: chmod 000 — SettingsStoreError',
    async () => {
      const { dir, store } = await open();
      await writeFiles(dir, { 'filters/f.json': wire(filter('f')) });
      await chmod(join(dir, 'filters', 'f.json'), 0o000);
      const error = await store.listFilters().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SettingsStoreError);
      expect((error as SettingsStoreError).path).toContain('f.json');
    },
  );
});

describe('study_session_manager', () => {
  it('list отсортирован; description/parts по умолчанию', async () => {
    const { dir, store } = await open();
    await store.saveSession(session('b'));
    await writeFiles(dir, {
      'study_sessions/a.json': JSON.stringify({ id: 'a' }),
    });
    expect(await store.listSessions()).toEqual([
      { id: 'a', description: '', parts: [] },
      session('b'),
    ]);
  });

  it('sessions_repeated_ids', async () => {
    const { dir, store } = await open();
    await writeFiles(dir, {
      'study_sessions/1.json': wire(session('s')),
      'study_sessions/2.json': wire(session('s')),
    });
    await expect(store.listSessions()).rejects.toThrow(SettingsStoreError);
  });

  it('read_bad_file_format', async () => {
    const { dir, store } = await open();
    await writeFiles(dir, { 'study_sessions/bad.json': 'not json' });
    await expect(store.listSessions()).rejects.toThrow(/bad\.json/);
  });

  it.skipIf(!posixPermissions)('read_bad_file_permissions', async () => {
    const { dir, store } = await open();
    await writeFiles(dir, { 'study_sessions/s.json': wire(session('s')) });
    await chmod(join(dir, 'study_sessions', 's.json'), 0o000);
    await expect(store.listSessions()).rejects.toThrow(SettingsStoreError);
  });

  it.skipIf(!posixPermissions)(
    'read_bad_directory: каталог без права чтения — SettingsStoreError',
    async () => {
      const { dir, store } = await open();
      await writeFiles(dir, { 'study_sessions/s.json': wire(session('s')) });
      await chmod(join(dir, 'study_sessions'), 0o000);
      try {
        await expect(store.listSessions()).rejects.toThrow(SettingsStoreError);
      } finally {
        await chmod(join(dir, 'study_sessions'), 0o755);
      }
    },
  );
});

describe('preferences_manager', () => {
  it('нет файла — умолчания (отличие от Trane)', async () => {
    const { store } = await open();
    expect(await store.loadPreferences()).toEqual({
      scheduler: null,
      ignored_paths: [],
      transcription: null,
    });
  });

  it('save/load ignored_paths и batch_size; формат файла Trane', async () => {
    const { dir, store } = await open();
    await store.savePreferences({
      scheduler: { batch_size: 25 },
      ignored_paths: ['a/b', 'c'],
      transcription: null,
    });
    expect(await store.loadPreferences()).toEqual({
      scheduler: { batch_size: 25 },
      ignored_paths: ['a/b', 'c'],
      transcription: null,
    });
    expect(await readFile(join(dir, 'user_preferences.json'), 'utf8')).toBe(
      `{
  "transcription": null,
  "scheduler": {
    "batch_size": 25
  },
  "ignored_paths": [
    "a/b",
    "c"
  ]
}
`,
    );
  });

  it('`{}` — все умолчания; битый файл — SettingsStoreError', async () => {
    const { dir, store } = await open();
    await writeFiles(dir, { 'user_preferences.json': '{}' });
    expect(await store.loadPreferences()).toMatchObject({
      scheduler: null,
      ignored_paths: [],
    });
    await writeFile(join(dir, 'user_preferences.json'), '{');
    await expect(store.loadPreferences()).rejects.toThrow(SettingsStoreError);
  });

  it('каталог вместо файла — SettingsStoreError', async () => {
    const { dir, store } = await open();
    await mkdir(join(dir, 'user_preferences.json'), { recursive: true });
    await expect(store.loadPreferences()).rejects.toThrow(SettingsStoreError);
  });

  it.skipIf(!posixPermissions)(
    'unwritable_preferences_file: каталог без прав — savePreferences отказ',
    async () => {
      const { dir, store } = await open();
      await chmod(dir, 0o500);
      try {
        await expect(
          store.savePreferences({ scheduler: null, ignored_paths: [] }),
        ).rejects.toThrow(SettingsStoreError);
      } finally {
        await chmod(dir, 0o755);
      }
    },
  );

  it.skipIf(!posixPermissions)(
    'EACCES при чтении — SettingsStoreError',
    async () => {
      const { dir, store } = await open();
      await writeFiles(dir, { 'user_preferences.json': '{}' });
      await chmod(join(dir, 'user_preferences.json'), 0o000);
      await expect(store.loadPreferences()).rejects.toThrow(SettingsStoreError);
    },
  );
});

describe('устойчивость к мусору в каталоге (T-04)', () => {
  it('.DS_Store, ._x.json, подкаталог, *.tmp, симлинк не ломают чтение', async () => {
    const { dir, store } = await open();
    await writeFiles(dir, {
      'filters/ok.json': wire(filter('ok')),
      'filters/.DS_Store': '\u0000\u0001binary',
      'filters/._ok.json': 'AppleDouble garbage',
      'filters/ok.json.123.abcd.tmp': '{ half-written',
      'filters/notes.txt': 'text',
      'filters/nested/inner.json': 'garbage',
      'filters/dir.json/inner.json': 'garbage',
    });
    await symlink(
      join(dir, 'filters', 'ok.json'),
      join(dir, 'filters', 'link.json'),
    );
    expect(await store.listFilters()).toEqual([filter('ok')]);
  });

  it('то же для study_sessions', async () => {
    const { dir, store } = await open();
    await writeFiles(dir, {
      'study_sessions/s.json': wire(session('s')),
      'study_sessions/.DS_Store': 'x',
      'study_sessions/sub/x.json': 'garbage',
    });
    expect(await store.listSessions()).toEqual([session('s')]);
  });

  it('удаление и запись не трогают мусор', async () => {
    const { dir, store } = await open();
    await writeFiles(dir, {
      'filters/.DS_Store': 'x',
      'filters/nested/inner.json': 'garbage',
    });
    await store.saveFilter(filter('a'));
    expect(await store.deleteFilter('a')).toBe(true);
    expect((await readdir(join(dir, 'filters'))).sort()).toEqual([
      '.DS_Store',
      'nested',
    ]);
  });
});

describe('запись', () => {
  it('canonicalFileName кодирует всё кроме [A-Za-z0-9_-]', () => {
    expect(canonicalFileName('Ab_9-z')).toBe('Ab_9-z.json');
    expect(canonicalFileName('c1::l1')).toBe('c1%3A%3Al1.json');
    expect(canonicalFileName('../x.y')).toBe('%2E%2E%2Fx%2Ey.json');
    expect(canonicalFileName('я')).toBe('%D1%8F.json');
    expect(canonicalFileName('😀')).toBe('%F0%9F%98%80.json');
  });

  it('новый id пишется под каноническим именем, JSON 2 пробела + \\n', async () => {
    const { dir, store } = await open();
    await store.saveFilter(filter('c1::l1'));
    const text = await readFile(
      join(dir, 'filters', 'c1%3A%3Al1.json'),
      'utf8',
    );
    expect(text).toBe(wire(filter('c1::l1')));
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('сессия пишется с description и parts', async () => {
    const { dir, store } = await open();
    await store.saveSession({ id: 's' });
    expect(await readFile(join(dir, 'study_sessions', 's.json'), 'utf8')).toBe(
      wire({ id: 's', description: '', parts: [] }),
    );
  });

  it('перезапись id, лежащего под другим именем, не создаёт второй файл', async () => {
    const { dir, store } = await open();
    await writeFiles(dir, {
      'filters/legacy_1.json': wire(filter('f', 'old')),
    });
    await store.saveFilter(filter('f', 'new'));
    expect(await readdir(join(dir, 'filters'))).toEqual(['legacy_1.json']);
    expect(await store.listFilters()).toEqual([filter('f', 'new')]);
  });

  it('каноническое имя, занятое чужим id, не затирается', async () => {
    const { dir, store } = await open();
    await writeFiles(dir, { 'filters/b.json': wire(filter('a', 'other')) });
    await store.saveFilter(filter('b'));
    expect(await store.listFilters()).toEqual([
      filter('a', 'other'),
      filter('b'),
    ]);
    expect((await readdir(join(dir, 'filters'))).sort()).toEqual([
      'b.json',
      'b~1.json',
    ]);
  });

  it('пустой id отвергается', async () => {
    const { store } = await open();
    await expect(store.saveFilter(filter(''))).rejects.toThrow(
      SettingsStoreError,
    );
  });

  it('delete удаляет все файлы с этим id, чужие не трогает', async () => {
    const { dir, store } = await open();
    await writeFiles(dir, {
      'filters/1.json': wire(filter('dup')),
      'filters/2.json': wire(filter('dup')),
      'filters/3.json': wire(filter('keep')),
    });
    expect(await store.deleteFilter('dup')).toBe(true);
    expect(await readdir(join(dir, 'filters'))).toEqual(['3.json']);
    expect(await store.deleteFilter('dup')).toBe(false);
  });

  it('save при дублях id оставляет единственный файл', async () => {
    const { dir, store } = await open();
    await writeFiles(dir, {
      'filters/1.json': wire(filter('dup', 'a')),
      'filters/2.json': wire(filter('dup', 'b')),
    });
    await store.saveFilter(filter('dup', 'c'));
    expect(await readdir(join(dir, 'filters'))).toEqual(['1.json']);
    expect(await store.listFilters()).toEqual([filter('dup', 'c')]);
  });

  it('сортировка по кодовым точкам, а не UTF-16', async () => {
    const { store } = await open();
    // U+FF5E (BMP) < U+1F600 (пара суррогатов 0xD83D…) по кодовым точкам
    const ids = ['😀', '～', 'a', 'Z'];
    for (const id of ids) await store.saveFilter(filter(id));
    expect((await store.listFilters()).map((f) => f.id)).toEqual([
      'Z',
      'a',
      '～',
      '😀',
    ]);
  });

  it('недоступный каталог записи — SettingsStoreError', async () => {
    const { dir } = await open();
    await writeFile(join(dir, 'filters'), 'i am a file');
    const store = createJsonSettingsStore({ dir });
    await expect(store.saveFilter(filter('a'))).rejects.toThrow(
      SettingsStoreError,
    );
  });
});
