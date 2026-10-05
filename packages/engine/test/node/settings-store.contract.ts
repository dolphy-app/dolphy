import type {
  SavedFilterDto,
  StudySessionWire,
} from '@dolphy-app/engine-contract';
import { describe, expect, it } from 'vitest';
import type { SettingsStore } from '../../src/ports/index.ts';

const filter = (id: string, description = 'd'): SavedFilterDto => ({
  id,
  description,
  filter: { Dependencies: { unit_ids: ['u'], depth: 2 } },
});
const session = (id: string): StudySessionWire => ({
  id,
  description: 'd',
  parts: [
    { UnitFilter: { filter: 'ReviewListFilter', duration: 5 } },
    { SavedFilter: { filter_id: 'f', duration: 0 } },
  ],
});

/** Общий набор проверок адаптеров `SettingsStore` (память, JSON, SQLite). */
export const describeSettingsStoreContract = (
  name: string,
  make: () => Promise<SettingsStore>,
) =>
  describe(`SettingsStore (${name})`, () => {
    it('пустое хранилище: умолчания и пустые списки', async () => {
      const store = await make();
      expect(await store.loadPreferences()).toEqual({
        scheduler: null,
        ignored_paths: [],
        transcription: null,
      });
      expect(await store.listFilters()).toEqual([]);
      expect(await store.listSessions()).toEqual([]);
    });

    it('настройки: save → load', async () => {
      const store = await make();
      const prefs = {
        scheduler: { batch_size: 10 },
        ignored_paths: ['x', 'y/z'],
        transcription: null,
      };
      await store.savePreferences(prefs);
      expect(await store.loadPreferences()).toEqual(prefs);
    });

    it('списки отсортированы по id по кодовым точкам', async () => {
      const store = await make();
      for (const id of ['😀', 'b', '～', 'B', 'a']) {
        await store.saveFilter(filter(id));
        await store.saveSession(session(id));
      }
      const expected = ['B', 'a', 'b', '～', '😀'];
      expect((await store.listFilters()).map((f) => f.id)).toEqual(expected);
      expect((await store.listSessions()).map((s) => s.id)).toEqual(expected);
    });

    it('save с существующим id перезаписывает', async () => {
      const store = await make();
      await store.saveFilter(filter('f', 'one'));
      await store.saveFilter(filter('f', 'two'));
      await store.saveSession(session('s'));
      await store.saveSession({ id: 's', description: 'new' });
      expect(await store.listFilters()).toEqual([filter('f', 'two')]);
      expect(await store.listSessions()).toEqual([
        { id: 's', description: 'new', parts: [] },
      ]);
    });

    it('delete: true один раз, затем false; чужие id целы', async () => {
      const store = await make();
      await store.saveFilter(filter('a'));
      await store.saveFilter(filter('b'));
      await store.saveSession(session('a'));
      expect(await store.deleteFilter('a')).toBe(true);
      expect(await store.deleteFilter('a')).toBe(false);
      expect(await store.deleteFilter('nope')).toBe(false);
      expect((await store.listFilters()).map((f) => f.id)).toEqual(['b']);
      expect((await store.listSessions()).map((s) => s.id)).toEqual(['a']);
      expect(await store.deleteSession('a')).toBe(true);
      expect(await store.deleteSession('a')).toBe(false);
    });

    it('фильтры и сессии с одним id не пересекаются', async () => {
      const store = await make();
      await store.saveFilter(filter('same'));
      expect(await store.deleteSession('same')).toBe(false);
      expect(await store.listFilters()).toHaveLength(1);
    });

    it('id со спецсимволами переживают round-trip', async () => {
      const store = await make();
      for (const id of ['c1::l1', '../x', 'a b/я', '.hidden', 'x.json']) {
        await store.saveFilter(filter(id));
      }
      const ids = (await store.listFilters()).map((f) => f.id);
      expect(ids).toEqual(['../x', '.hidden', 'a b/я', 'c1::l1', 'x.json']);
      expect(await store.deleteFilter('.hidden')).toBe(true);
    });

    it('копии изолированы: вход и выход можно мутировать', async () => {
      const store = await make();
      const input = session('s');
      const prefs = {
        scheduler: { batch_size: 3 },
        ignored_paths: ['a'],
        transcription: null,
      };
      await store.saveSession(input);
      await store.savePreferences(prefs);
      input.parts!.length = 0;
      prefs.ignored_paths.push('mutated');

      const listed = await store.listSessions();
      listed[0]!.parts!.length = 0;
      listed[0]!.id = 'mutated';
      const loaded = await store.loadPreferences();
      loaded.ignored_paths.push('mutated-out');

      expect((await store.listSessions())[0]).toEqual(session('s'));
      expect((await store.loadPreferences()).ignored_paths).toEqual(['a']);
    });
    it('опции планировщика: пусто, save → load, копии изолированы', async () => {
      const store = await make();
      expect(await store.loadSchedulerOverrides()).toEqual({});

      const overrides = {
        batchSize: 7,
        masteryWindows: { new: { range: [0, 1.5] as [number, number] } },
      };
      await store.saveSchedulerOverrides(overrides);
      overrides.masteryWindows.new.range[1] = 9;

      const loaded = await store.loadSchedulerOverrides();
      expect(loaded).toEqual({
        batchSize: 7,
        masteryWindows: { new: { range: [0, 1.5] } },
      });
      loaded.batchSize = 1;
      expect((await store.loadSchedulerOverrides()).batchSize).toBe(7);

      await store.saveSchedulerOverrides({});
      expect(await store.loadSchedulerOverrides()).toEqual({});
    });

    it('интерфейс: по умолчанию system/system, save → load', async () => {
      const store = await make();
      expect(await store.loadUi()).toEqual({
        theme: 'system',
        locale: 'system',
      });
      await store.saveUi({ theme: 'dark', locale: 'en' });
      expect(await store.loadUi()).toEqual({ theme: 'dark', locale: 'en' });
      await store.saveUi({ theme: 'light', locale: 'ru' });
      expect(await store.loadUi()).toEqual({ theme: 'light', locale: 'ru' });
      await store.saveUi({ theme: 'acme.midnight', locale: 'ru' });
      expect(await store.loadUi()).toEqual({
        theme: 'acme.midnight',
        locale: 'ru',
      });
    });

    it('интерфейс: ширина и скрытие панели теории переживают save → load', async () => {
      const store = await make();
      await store.saveUi({
        theme: 'dark',
        locale: 'ru',
        materialWidth: 420,
        materialCollapsed: true,
      });
      expect(await store.loadUi()).toEqual({
        theme: 'dark',
        locale: 'ru',
        materialWidth: 420,
        materialCollapsed: true,
      });
      await store.saveUi({ theme: 'dark', locale: 'ru' });
      expect(await store.loadUi()).toEqual({ theme: 'dark', locale: 'ru' });
    });

    it('обучение: по умолчанию passAtN, save → load', async () => {
      const store = await make();
      expect(await store.loadLearning()).toEqual({ gradePolicy: 'passAtN' });
      await store.saveLearning({ gradePolicy: 'acme.policy.generous' });
      expect(await store.loadLearning()).toEqual({
        gradePolicy: 'acme.policy.generous',
      });
      await store.saveLearning({ gradePolicy: 'passAtN' });
      expect(await store.loadLearning()).toEqual({ gradePolicy: 'passAtN' });
    });

    it('привязки: по умолчанию пусто, save → load, замена целиком', async () => {
      const store = await make();
      expect(await store.loadKeybindings()).toEqual({ commands: {} });
      await store.saveKeybindings({
        commands: {
          'app:a': [{ key: 'Mod+K', when: null }],
          'extension:acme:run': [],
        },
      });
      expect(await store.loadKeybindings()).toEqual({
        commands: {
          'app:a': [{ key: 'Mod+K', when: null }],
          'extension:acme:run': [],
        },
      });
      await store.saveKeybindings({
        commands: { 'app:b': [{ key: 'Alt+J', when: '!inputFocus' }] },
      });
      expect(await store.loadKeybindings()).toEqual({
        commands: { 'app:b': [{ key: 'Alt+J', when: '!inputFocus' }] },
      });
    });

    it('привязки: хранилище не делит память с вызывающим и не меняет другие группы', async () => {
      const store = await make();
      const saved = { commands: { 'app:a': [{ key: 'Alt+1', when: null }] } };
      await store.saveKeybindings(saved);
      saved.commands['app:a'][0]!.key = 'Alt+2';
      const loaded = await store.loadKeybindings();
      expect(loaded.commands['app:a']?.[0]?.key).toBe('Alt+1');
      loaded.commands['app:a']![0]!.key = 'Alt+3';
      expect((await store.loadKeybindings()).commands['app:a']?.[0]?.key).toBe(
        'Alt+1',
      );
      expect(await store.loadLearning()).toEqual({ gradePolicy: 'passAtN' });
      expect((await store.loadUi()).theme).toBe('system');
    });

    it('расширения: по умолчанию пусто, проверка обновлений включена', async () => {
      const store = await make();
      expect(await store.loadExtensions()).toEqual({
        disabled: [],
        trusted: [],
        checkUpdates: true,
        safeMode: false,
        notificationsOff: [],
        catalogUrl: null,
      });
    });

    it('расширения: save → load, списки канонические, checkUpdates=false переживает круг', async () => {
      const store = await make();
      await store.saveExtensions({
        disabled: ['acme.b', 'acme.a', 'acme.b'],
        trusted: ['acme.z'],
        checkUpdates: false,
        safeMode: false,
        notificationsOff: [],
        catalogUrl: null,
      });
      expect(await store.loadExtensions()).toEqual({
        disabled: ['acme.a', 'acme.b'],
        trusted: ['acme.z'],
        checkUpdates: false,
        safeMode: false,
        notificationsOff: [],
        catalogUrl: null,
      });
      await store.saveExtensions({
        disabled: [],
        trusted: [],
        checkUpdates: true,
        safeMode: false,
        notificationsOff: [],
        catalogUrl: null,
      });
      expect(await store.loadExtensions()).toEqual({
        disabled: [],
        trusted: [],
        checkUpdates: true,
        safeMode: false,
        notificationsOff: [],
        catalogUrl: null,
      });
    });

    it('расширения: безопасный режим по умолчанию выключен и переживает круг сохранения вместе со списками', async () => {
      const store = await make();
      expect((await store.loadExtensions()).safeMode).toBe(false);
      await store.saveExtensions({
        disabled: ['acme.a'],
        trusted: ['acme.t'],
        checkUpdates: false,
        safeMode: true,
        notificationsOff: [],
        catalogUrl: null,
      });
      expect(await store.loadExtensions()).toEqual({
        disabled: ['acme.a'],
        trusted: ['acme.t'],
        checkUpdates: false,
        safeMode: true,
        notificationsOff: [],
        catalogUrl: null,
      });
      await store.saveExtensions({
        disabled: ['acme.a'],
        trusted: ['acme.t'],
        checkUpdates: false,
        safeMode: false,
        notificationsOff: [],
        catalogUrl: null,
      });
      expect((await store.loadExtensions()).safeMode).toBe(false);
    });

    it('расширения: notificationsOff переживает круг сохранения, канонический и независимый от остальных полей', async () => {
      const store = await make();
      await store.saveExtensions({
        disabled: ['acme.d'],
        trusted: [],
        checkUpdates: true,
        safeMode: false,
        notificationsOff: ['acme.z', 'acme.a', 'acme.z'],
        catalogUrl: null,
      });
      expect(await store.loadExtensions()).toEqual({
        disabled: ['acme.d'],
        trusted: [],
        checkUpdates: true,
        safeMode: false,
        notificationsOff: ['acme.a', 'acme.z'],
        catalogUrl: null,
      });
    });

    it('метка проверки обновлений: по умолчанию null, save → load', async () => {
      const store = await make();
      expect(await store.loadUpdateCheckedAt()).toBeNull();
      await store.saveUpdateCheckedAt(1_700_000_000_000);
      expect(await store.loadUpdateCheckedAt()).toBe(1_700_000_000_000);
    });

    it('метка проверки обновлений: null сбрасывает сохранённое значение', async () => {
      const store = await make();
      await store.saveUpdateCheckedAt(1_700_000_000_000);
      await store.saveUpdateCheckedAt(null);
      expect(await store.loadUpdateCheckedAt()).toBeNull();
    });

    it('расширения: адрес каталога переживает круг сохранения и сбрасывается в null', async () => {
      const store = await make();
      expect((await store.loadExtensions()).catalogUrl).toBeNull();
      await store.saveExtensions({
        disabled: [],
        trusted: [],
        checkUpdates: true,
        safeMode: false,
        notificationsOff: [],
        catalogUrl: 'https://example.test/catalog/index.json',
      });
      expect((await store.loadExtensions()).catalogUrl).toBe(
        'https://example.test/catalog/index.json',
      );
      await store.saveExtensions({
        disabled: [],
        trusted: [],
        checkUpdates: true,
        safeMode: false,
        notificationsOff: [],
        catalogUrl: null,
      });
      expect((await store.loadExtensions()).catalogUrl).toBeNull();
    });

    it('значения разных видов не мешают друг другу', async () => {
      const store = await make();
      await store.saveSchedulerOverrides({ batchSize: 3 });
      await store.saveUi({ theme: 'dark', locale: 'ru' });
      await store.saveLearning({ gradePolicy: 'acme.policy' });
      await store.saveExtensions({
        disabled: ['acme.x'],
        trusted: [],
        checkUpdates: true,
        safeMode: false,
        notificationsOff: [],
        catalogUrl: null,
      });
      await store.savePreferences({
        scheduler: null,
        ignored_paths: ['x'],
        transcription: null,
      });
      expect((await store.loadSchedulerOverrides()).batchSize).toBe(3);
      expect(await store.loadUi()).toEqual({ theme: 'dark', locale: 'ru' });
      expect(await store.loadLearning()).toEqual({
        gradePolicy: 'acme.policy',
      });
      expect(await store.loadExtensions()).toEqual({
        disabled: ['acme.x'],
        trusted: [],
        checkUpdates: true,
        safeMode: false,
        notificationsOff: [],
        catalogUrl: null,
      });
      expect((await store.loadPreferences()).ignored_paths).toEqual(['x']);
    });
  });
