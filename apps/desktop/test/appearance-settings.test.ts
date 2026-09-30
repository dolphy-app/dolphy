import { effectScope } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { LearningEngine } from '@dolphy-app/engine-contract';
import { useAppearanceSettings } from '@/pages/settings/model/appearance.ts';

const changes: string[] = [];
vi.mock('vuetify', () => ({
  useTheme: () => ({ change: (name: string) => changes.push(name) }),
}));
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'ru' } }),
}));
vi.mock('vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue')>()),
  onMounted: (hook: () => void) => void hook(),
}));

const themes = [{ id: 'acme.midnight' }] as never;

const setup = (saved: string, failWith: Error | null = null) => {
  const saves: unknown[] = [];
  const engine = {
    settings: {
      getUi: async () => ({ theme: saved, locale: 'system' }),
      setUi: async (patch: unknown) => {
        saves.push(patch);
        if (failWith) throw failWith;
      },
    },
  } as unknown as LearningEngine;
  const scope = effectScope();
  const model = scope.run(() => useAppearanceSettings(engine, themes))!;
  return { model, saves };
};

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('useAppearanceSettings theme', () => {
  it('select applies the Vuetify name and saves the id', async () => {
    changes.length = 0;
    const { model, saves } = setup('light');
    await settle();
    await model.select('acme.midnight');
    expect(model.mode.value).toBe('acme.midnight');
    expect(changes).toEqual(['ext__acme__midnight']);
    expect(saves).toEqual([{ theme: 'acme.midnight' }]);
  });

  it('rolls back on failure', async () => {
    changes.length = 0;
    const { model } = setup('dark', new Error('boom'));
    await settle();
    await model.select('acme.midnight');
    expect(model.mode.value).toBe('dark');
    expect(changes).toEqual(['ext__acme__midnight', 'dark']);
    expect(model.error.value).toBe('boom');
  });

  it('shows system for an unknown saved theme without rewriting it', async () => {
    const { model, saves } = setup('gone.theme');
    await settle();
    expect(model.mode.value).toBe('system');
    expect(saves).toEqual([]);
  });
});
