import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createJsonSettingsStore } from '../../src/node/json-settings-store.ts';
import { createMemorySettingsStore } from '../../src/node/memory-settings-store.ts';
import { useTmpDirs } from '../helpers/tmp.ts';
import { describeSettingsStoreContract } from './settings-store.contract.ts';

const tmp = useTmpDirs();

describeSettingsStoreContract('memory', async () =>
  createMemorySettingsStore(),
);
describeSettingsStoreContract('json', async () =>
  createJsonSettingsStore({ dir: await tmp.make('settings-') }),
);

describe('createMemorySettingsStore(initial)', () => {
  it('стартовые данные копируются', async () => {
    const filter = {
      id: 'f',
      description: 'd',
      filter: { Dependencies: { unit_ids: ['u'], depth: 2 } },
    };
    const initial = {
      filters: [structuredClone(filter)],
      schedulerOverrides: { batchSize: 3 },
    };
    const store = createMemorySettingsStore(initial);
    initial.filters[0]!.description = 'mutated';
    initial.schedulerOverrides.batchSize = 9;
    expect(await store.listFilters()).toEqual([filter]);
    expect((await store.loadSchedulerOverrides()).batchSize).toBe(3);
  });
});

describe('createJsonSettingsStore: свои файлы движка', () => {
  it('привязки лежат в keybindings.json; нечитаемые записи отброшены, остальные действуют', async () => {
    const dir = await tmp.make('settings-');
    const store = createJsonSettingsStore({ dir });
    await store.saveKeybindings({
      commands: { 'app:a': [{ key: 'Alt+1', when: null }] },
    });
    expect(
      JSON.parse(await readFile(`${dir}/keybindings.json`, 'utf8')),
    ).toEqual({ commands: { 'app:a': [{ key: 'Alt+1', when: null }] } });
    await writeFile(
      `${dir}/keybindings.json`,
      JSON.stringify({
        commands: {
          'app:a': [
            { key: 'Alt+1' },
            { key: 5 },
            'x',
            { key: 'Alt+2', when: 3 },
          ],
          'bad key': [{ key: 'Alt+3', when: null }],
          'app:b': 'oops',
        },
      }),
    );
    expect(await store.loadKeybindings()).toEqual({
      commands: { 'app:a': [{ key: 'Alt+1', when: null }] },
    });
    await writeFile(`${dir}/keybindings.json`, '[]');
    expect(await store.loadKeybindings()).toEqual({ commands: {} });
  });

  it('битое поле интерфейса заменяется умолчанием поодиночке, битые опции — пустыми', async () => {
    const dir = await tmp.make('settings-');
    await writeFile(`${dir}/ui.json`, '{"theme":"Sepia!","locale":"ru","x":1}');
    await writeFile(`${dir}/scheduler_overrides.json`, '"oops"');
    const store = createJsonSettingsStore({ dir });
    expect(await store.loadUi()).toEqual({ theme: 'system', locale: 'ru' });
    expect(await store.loadSchedulerOverrides()).toEqual({});
  });

  it('файл расширений прежней формы (без checkUpdates) — проверка включена', async () => {
    const dir = await tmp.make('settings-');
    await writeFile(
      `${dir}/extensions.json`,
      '{"disabled":["acme.a"],"trusted":[]}',
    );
    const store = createJsonSettingsStore({ dir });
    expect(await store.loadExtensions()).toEqual({
      disabled: ['acme.a'],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });
  });
});
