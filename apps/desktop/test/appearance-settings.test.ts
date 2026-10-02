import { effectScope, shallowRef } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  LearningEngine,
  ThemeContributionDto,
} from '@dolphy-app/engine-contract';
import { useAppearanceSettings } from '@/pages/settings/model/appearance.ts';
import { createLocaleSelection } from '@/shared/api/engine/locale-selection.ts';
import { createThemeSelection } from '@/shared/api/engine/theme-selection.ts';
import { createEventBus } from './support/extensions-fakes.ts';

const MIDNIGHT = { id: 'acme.midnight' } as ThemeContributionDto;

const setup = (saved: string, failWith: Error | null = null) => {
  const saves: unknown[] = [];
  const bus = createEventBus();
  const engine = {
    subscribe: bus.subscribe,
    settings: {
      getUi: async () => ({ theme: saved, locale: 'system' }),
      setUi: async (patch: unknown) => {
        saves.push(patch);
        if (failWith) throw failWith;
      },
    },
  } as unknown as LearningEngine;
  const applied: string[] = [];
  const localeSelection = createLocaleSelection(engine, 'system', {
    apply: (next) => applied.push(next),
    systemLanguage: () => 'ru-RU',
  });
  const themes = shallowRef<readonly ThemeContributionDto[]>([MIDNIGHT]);
  const selection = createThemeSelection(engine, saved);
  const model = effectScope().run(() =>
    useAppearanceSettings(selection, localeSelection, () => themes.value),
  )!;
  return { model, saves, selection, themes, applied };
};

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('useAppearanceSettings theme', () => {
  it('select saves the id and shows it at once', async () => {
    const { model, saves, selection } = setup('light');
    await settle();
    const saving = model.select('acme.midnight');
    expect(model.mode.value).toBe('acme.midnight');
    expect(selection.saved.value).toBe('acme.midnight');
    await saving;
    expect(saves).toEqual([{ theme: 'acme.midnight' }]);
  });

  it('rolls back and reports the error when saving fails', async () => {
    const { model, selection } = setup('dark', new Error('boom'));
    await settle();
    await model.select('acme.midnight');
    expect(model.mode.value).toBe('dark');
    expect(selection.saved.value).toBe('dark');
    expect(model.error.value).toBe('boom');
  });

  it('shows system for an unknown saved theme without rewriting it', async () => {
    const { model, saves, selection } = setup('gone.theme');
    await settle();
    expect(model.mode.value).toBe('system');
    expect(selection.saved.value).toBe('gone.theme');
    expect(saves).toEqual([]);
  });

  it('follows the contributions: the theme of a removed extension shows as system and returns with it', async () => {
    const { model, themes, saves } = setup('acme.midnight');
    await settle();
    expect(model.mode.value).toBe('acme.midnight');
    themes.value = [];
    expect(model.mode.value).toBe('system');
    themes.value = [MIDNIGHT];
    expect(model.mode.value).toBe('acme.midnight');
    expect(saves).toEqual([]);
  });
});

describe('useAppearanceSettings language', () => {
  it('selectLocale applies the language at once and saves it', async () => {
    const { model, saves, applied } = setup('light');
    const saving = model.selectLocale('en');
    expect(model.localeMode.value).toBe('en');
    expect(applied).toEqual(['en']);
    await saving;
    expect(saves).toEqual([{ locale: 'en' }]);
  });

  it('rolls back the language and reports the error when saving fails', async () => {
    const { model, applied } = setup('light', new Error('boom'));
    await model.selectLocale('en');
    expect(model.localeMode.value).toBe('system');
    expect(applied).toEqual(['en', 'ru']);
    expect(model.error.value).toBe('boom');
  });

  it('ignores null from the toggle when the selection is cleared', async () => {
    const { model, saves } = setup('light');
    await model.selectLocale(null);
    expect(saves).toEqual([]);
  });
});
