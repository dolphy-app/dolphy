import { describe, expect, it } from 'vitest';
import type { LearningEngine, LocaleMode } from '@dolphy-app/engine-contract';
import { createLocaleSelection } from '@/shared/api/engine/locale-selection.ts';
import { createEventBus } from './support/extensions-fakes.ts';

const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const setup = (initial: LocaleMode, systemLanguage = 'en-US') => {
  const bus = createEventBus();
  const state = {
    stored: initial,
    fail: null as Error | null,
    release: null as (() => void) | null,
    hold: false,
  };
  const saves: unknown[] = [];
  const engine = {
    subscribe: bus.subscribe,
    settings: {
      getUi: async () => ({ theme: 'system', locale: state.stored }),
      setUi: async (patch: { locale?: LocaleMode }) => {
        saves.push(patch);
        if (state.hold) {
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
        }
        if (state.fail) throw state.fail;
        if (patch.locale !== undefined) state.stored = patch.locale;
      },
    },
  } as unknown as LearningEngine;
  const applied: string[] = [];
  const selection = createLocaleSelection(engine, initial, {
    apply: (locale) => applied.push(locale),
    systemLanguage: () => systemLanguage,
  });
  return { selection, bus, state, saves, applied };
};

describe('createLocaleSelection', () => {
  it('applies a chosen language at once and saves it', async () => {
    const { selection, saves, applied, state } = setup('system');
    state.hold = true;
    const saving = selection.select('ru');
    expect(selection.saved.value).toBe('ru');
    expect(applied).toEqual(['ru']);
    state.release?.();
    await saving;
    expect(saves).toEqual([{ locale: 'ru' }]);
  });

  it('system mode resolves by the system language, unsupported falls back to en', async () => {
    const ru = setup('en', 'ru-RU');
    await ru.selection.select('system');
    expect(ru.applied).toEqual(['ru']);
    const other = setup('ru', 'de-DE');
    await other.selection.select('system');
    expect(other.applied).toEqual(['en']);
    expect(other.selection.saved.value).toBe('system');
  });

  it('rolls back the selection and the applied language when saving fails', async () => {
    const { selection, applied, state } = setup('ru');
    state.fail = new Error('boom');
    await expect(selection.select('en')).rejects.toThrow('boom');
    expect(selection.saved.value).toBe('ru');
    expect(applied).toEqual(['en', 'ru']);
  });

  it('adopts a language changed elsewhere (settings-changed ui)', async () => {
    const { selection, bus, state, applied } = setup('ru');
    state.stored = 'en';
    bus.emit({ type: 'settings-changed', scope: 'ui' });
    await flush();
    expect(selection.saved.value).toBe('en');
    expect(applied).toEqual(['en']);
  });

  it('ignores other scopes and does not re-apply an unchanged language', async () => {
    const { selection, bus, state, applied } = setup('ru');
    state.stored = 'en';
    bus.emit({ type: 'settings-changed', scope: 'learning' });
    await flush();
    expect(selection.saved.value).toBe('ru');
    state.stored = 'ru';
    bus.emit({ type: 'settings-changed', scope: 'ui' });
    await flush();
    expect(applied).toEqual([]);
  });

  it('a re-read does not undo a selection that is still being saved', async () => {
    const { selection, bus, state } = setup('ru');
    state.hold = true;
    const saving = selection.select('en');
    bus.emit({ type: 'settings-changed', scope: 'ui' });
    await flush();
    expect(selection.saved.value).toBe('en');
    state.release?.();
    await saving;
  });

  it('dispose unsubscribes from the engine', async () => {
    const { selection, bus, state } = setup('ru');
    selection.dispose();
    state.stored = 'en';
    bus.emit({ type: 'settings-changed', scope: 'ui' });
    await flush();
    expect(selection.saved.value).toBe('ru');
  });
});
