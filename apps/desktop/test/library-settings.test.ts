import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  LearningEngine,
  LibraryInfo,
  PreferencesDto,
} from '@lms/engine-contract';
import {
  normalizeIgnoredPath,
  useLibrarySettings,
} from '@/pages/settings/model/library.ts';

const libraryInfo = (revision: string): LibraryInfo => ({
  contractVersion: 1,
  root: '/lib',
  revision,
  state: 'ready',
  artifact: 'fresh',
  counts: { courses: 1, lessons: 2, exercises: 3, dependencyEdges: 0 },
  diagnostics: { errors: 0, warnings: 0, infos: 0 },
  loadedAt: 0,
  loadMs: 1,
});

const createFakeEngine = (preferences: PreferencesDto) => {
  let stored = preferences;
  let revision = 1;
  const saved: PreferencesDto[] = [];
  const order: string[] = [];
  const engine = {
    library: {
      getInfo: async () => libraryInfo(`r${revision}`),
      reload: async () => {
        order.push('reload');
        revision += 1;
        return libraryInfo(`r${revision}`);
      },
    },
    settings: {
      getPreferences: async () => structuredClone(stored),
      setPreferences: async (next: PreferencesDto) => {
        order.push('setPreferences');
        saved.push(next);
        stored = next;
        return { restartRequired: false };
      },
    },
    subscribe: () => () => {},
  } as unknown as LearningEngine;
  return { engine, saved, order };
};

const MICROTASK_ROUNDS = 10;
const flush = async () => {
  for (let round = 0; round < MICROTASK_ROUNDS; round++)
    await Promise.resolve();
};

const mount = (engine: LearningEngine) =>
  effectScope().run(() => useLibrarySettings(engine))!;

describe('normalizeIgnoredPath', () => {
  it('приводит ввод к относительному пути с «/»', () => {
    expect(normalizeIgnoredPath('  ./drafts/old\\ ')).toBe('drafts/old');
    expect(normalizeIgnoredPath('/a/b//')).toBe('a/b');
  });

  it('пустой ввод — null', () => {
    for (const input of ['', '   ', '/', './', '//']) {
      expect(normalizeIgnoredPath(input)).toBeNull();
    }
  });
});

describe('useLibrarySettings', () => {
  it('не добавляет пустой путь и дубликат, отмечает черновик как изменённый', async () => {
    const fake = createFakeEngine({ ignoredPaths: ['a'] });
    const settings = mount(fake.engine);
    await flush();

    expect(settings.addPath(' ')).toBe(false);
    expect(settings.addPath('./a/')).toBe(false);
    expect(settings.isDirty.value).toBe(false);

    expect(settings.addPath('b')).toBe(true);
    expect(settings.draftPaths.value).toEqual(['a', 'b']);
    expect(settings.isDirty.value).toBe(true);

    settings.revert();
    expect(settings.draftPaths.value).toEqual(['a']);
    expect(settings.isDirty.value).toBe(false);
  });

  it('применение сохраняет пути, не трогает размер пачки и затем перечитывает библиотеку', async () => {
    const fake = createFakeEngine({
      ignoredPaths: ['a'],
      schedulerBatchSize: 30,
    });
    const settings = mount(fake.engine);
    await flush();
    settings.addPath('b');
    settings.removePath('a');
    await settings.apply();

    expect(fake.saved).toEqual([
      { ignoredPaths: ['b'], schedulerBatchSize: 30 },
    ]);
    expect(fake.order).toEqual(['setPreferences', 'reload']);
    expect(settings.isDirty.value).toBe(false);
    expect(settings.info.value?.revision).toBe('r2');
  });
});
