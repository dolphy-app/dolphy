# Recipe: an importer and an exporter

An importer turns a file the user picked into a new course; an exporter turns a
course (or the learning progress) into a file the user saves. Your code only
handles strings: the app shows the file dialogs, checks what you return with the
course compiler, and writes to disk. This recipe has no template of its own:
start from `blank` and replace the three files below, which are checked as a
whole project. See [quick-start.md](quick-start.md) for the commands.

## The manifest

File `extension.json` (import-export):

```json
{
  "$schema": "./node_modules/@dolphy-app/extension-api/dist/extension.schema.json",
  "id": "acme.hello",
  "version": "0.1.0",
  "apiVersion": 1,
  "name": "Hello cards",
  "description": "Import flashcards from a CSV file and export a course back to CSV.",
  "author": "your-github-login",
  "tags": ["content"],
  "contributes": {
    "importers": [
      { "id": "acme.hello.import", "title": "Cards from CSV", "accept": [".csv"] }
    ],
    "exporters": [
      { "id": "acme.hello.export", "title": "Course to CSV", "scope": "course" }
    ]
  }
}
```

- An importer has an `id`, a `title` (up to 60 characters), `accept` (1–8
  lower-case file extensions such as `.csv`) and an optional `input`: `text`
  (the default, the handler gets the file as a UTF-8 string) or `bytes` (a
  `Uint8Array`). An exporter has `scope`: `course` or `progress`.
- No permission is needed: the user choosing the file is the consent, and your
  code never sees a path. A `progress` exporter reads `ctx.stats` and needs the
  `learning.stats` permission.
- The importer appears in the palette as "Import: Cards from CSV", the exporter
  as "Export: Course to CSV", and both have buttons in Settings → Library.

## The code

File `src/index.ts` (import-export):

```ts
import { defineExtension } from '@dolphy-app/extension-sdk';
import type {
  CourseExportInput,
  TextImportInput,
} from '@dolphy-app/extension-sdk';

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const courseIdOf = (fileName: string): string =>
  fileName
    .replace(/\.csv$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'cards';

export const host = defineExtension({
  importers: {
    // one line "front,back" is one flashcard; the paths are relative to the
    // new course directory the app creates
    'acme.hello.import': ({ name, text }: TextImportInput) => {
      const rows = text.split(/\r?\n/).filter((line) => line.trim() !== '');
      if (rows.length === 0) throw new Error('The file has no rows');
      const course = courseIdOf(name);
      const lesson = `${course}::cards`;
      const files: Record<string, string> = {
        [`${course}/course_manifest.json`]: json({
          id: course,
          name: name.replace(/\.csv$/i, ''),
          dependencies: [],
          encompassed: [],
          superseded: [],
        }),
        [`${course}/cards/lesson_manifest.json`]: json({
          id: lesson,
          name: 'Cards',
          course_id: course,
          dependencies: [],
          encompassed: [],
          superseded: [],
        }),
      };
      rows.forEach((row, index) => {
        const comma = row.indexOf(',');
        if (comma <= 0 || comma === row.length - 1) {
          throw new Error(`Row ${index + 1}: expected "front,back"`);
        }
        const dir = `${course}/cards/c${index + 1}`;
        files[`${dir}/exercise_manifest.json`] = json({
          id: `${lesson}::c${index + 1}`,
          name: `Card ${index + 1}`,
          lesson_id: lesson,
          course_id: course,
          exercise_type: 'Declarative',
          exercise_asset: {
            FlashcardAsset: { front_path: 'front.md', back_path: 'back.md' },
          },
        });
        files[`${dir}/front.md`] = `${row.slice(0, comma).trim()}\n`;
        files[`${dir}/back.md`] = `${row.slice(comma + 1).trim()}\n`;
      });
      return { files };
    },
  },
  exporters: {
    // the snapshot holds the text files of the chosen course, paths relative
    // to the course directory
    'acme.hello.export': ({ title, files }: CourseExportInput) => {
      const cell = (text: string): string => text.trim().replace(/\s+/g, ' ');
      const fronts = Object.keys(files)
        .filter((path) => path.endsWith('/front.md'))
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
      const rows = fronts.map((path) => {
        const back = files[`${path.slice(0, -'front.md'.length)}back.md`];
        return `${cell(files[path] ?? '')},${cell(back ?? '')}`;
      });
      return {
        filename: `${title.replace(/[\\/]/g, '-').slice(0, 100)}.csv`,
        text: `${rows.join('\n')}\n`,
      };
    },
  },
});
```

- An importer handler gets `{ name, text }` (or `{ name, bytes }`) and returns
  `{ files: Record<path, text> }`: the files of a new directory in the library
  (`imported/<extension id>-<file name>`). At most 5000 files, 2 MiB each and
  20 MiB in all; a path is relative, uses `/`, and has no `..`, empty or
  dot-leading segment, backslash, control character, or case-only duplicate.
  Binary files are not supported: every file is text.
- The app compiles the tree before it writes anything and shows a summary
  (courses, lessons, exercises) and diagnostics. With an error the user cannot
  import, and nothing is left on disk. Importing the same file name again with
  the same extension replaces the previous directory.
- An exporter handler gets `{ scope: 'course', courseId, title, files }` (or
  `{ scope: 'progress' }`) and returns `{ filename, text }` or
  `{ filename, bytes }` of at most 20 MiB. The file name has no path separator
  and is at most 120 characters. The app asks the user where to save it.
- A handler has 30 seconds. Throw an `Error` to refuse: its message reaches the
  user, and nothing is written.
- A handler that needs `ctx` is registered in `activate` with
  `ctx.importers.register(id, handler)` / `ctx.exporters.register(id, handler)`
  (`inActivate` in the record, as for commands).

## The tests

File `test/index.test.ts` (import-export):

```ts
import {
  loadExporters,
  loadImporters,
} from '@dolphy-app/extension-sdk/testing';
import { describe, expect, it } from 'vitest';
import { host } from '../src/index.ts';

const CSV = 'hola,hello\nadiós,goodbye\n';

describe('acme.hello: importer', () => {
  it('turns every row into a flashcard of one lesson', async () => {
    const importers = await loadImporters(host, {
      declaredImporters: [{ id: 'acme.hello.import' }],
    });
    const { files } = await importers.run('acme.hello.import', {
      name: 'Spanish basics.csv',
      text: CSV,
    });
    expect(Object.keys(files).sort()).toEqual([
      'spanish-basics/cards/c1/back.md',
      'spanish-basics/cards/c1/exercise_manifest.json',
      'spanish-basics/cards/c1/front.md',
      'spanish-basics/cards/c2/back.md',
      'spanish-basics/cards/c2/exercise_manifest.json',
      'spanish-basics/cards/c2/front.md',
      'spanish-basics/cards/lesson_manifest.json',
      'spanish-basics/course_manifest.json',
    ]);
    expect(files['spanish-basics/cards/c2/front.md']).toBe('adiós\n');
    await importers.dispose();
  });

  it('refuses a row without an answer', async () => {
    const importers = await loadImporters(host, {
      declaredImporters: [{ id: 'acme.hello.import' }],
    });
    await expect(
      importers.run('acme.hello.import', { name: 'x.csv', text: 'hola\n' }),
    ).rejects.toThrow('Row 1');
    await importers.dispose();
  });
});

describe('acme.hello: exporter', () => {
  it('writes the cards of the snapshot back to CSV', async () => {
    const exporters = await loadExporters(host, {
      declaredExporters: [{ id: 'acme.hello.export', scope: 'course' }],
    });
    const result = await exporters.run('acme.hello.export', {
      scope: 'course',
      courseId: 'deck',
      title: 'Deck / Spanish',
      files: {
        'cards/c1/front.md': 'hola\n',
        'cards/c1/back.md': 'hello\n',
        'cards/c10/front.md': 'diez\n',
        'cards/c10/back.md': 'ten\n',
        'cards/c2/front.md': 'adiós\n',
        'cards/c2/back.md': 'goodbye\n',
      },
    });
    expect(result).toEqual({
      filename: 'Deck - Spanish.csv',
      text: 'hola,hello\nadiós,goodbye\ndiez,ten\n',
    });
    await exporters.dispose();
  });
});
```

`loadImporters` and `loadExporters` activate the module in memory and run a
handler with the rules of the host: the `text`/`bytes` form of a declared
importer, the `scope` of a declared exporter, the size of the input and the
shape and limits of the result. A broken result rejects with
`invalid import result: …` / `invalid export result: …`, so the test fails the
way the app would refuse it. For a `progress` exporter pass
`stats: createMemoryStats(…)`.

## Try and ship

Run `pnpm dev`, start the app with `DOLPHY_DEV_EXTENSIONS`, open the palette and
run "Import: Cards from CSV". After you confirm the summary the course shows up
in Courses without a restart. See [debugging.md](debugging.md) for the rest.
