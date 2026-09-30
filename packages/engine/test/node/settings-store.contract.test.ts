import { writeFile } from 'node:fs/promises';
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
  it('битое поле интерфейса заменяется умолчанием поодиночке, битые опции — пустыми', async () => {
    const dir = await tmp.make('settings-');
    await writeFile(`${dir}/ui.json`, '{"theme":"sepia","locale":"ru","x":1}');
    await writeFile(`${dir}/scheduler_overrides.json`, '"oops"');
    const store = createJsonSettingsStore({ dir });
    expect(await store.loadUi()).toEqual({ theme: 'system', locale: 'ru' });
    expect(await store.loadSchedulerOverrides()).toEqual({});
  });
});
