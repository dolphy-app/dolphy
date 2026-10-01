import { describe, expect, it } from 'vitest';
import type { LearningEngine } from '@dolphy-app/engine-contract';
import { createThemeSelection } from '@/shared/api/engine/theme-selection.ts';
import { createEventBus } from './support/extensions-fakes.ts';

const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const setup = (initial: string) => {
  const bus = createEventBus();
  const state = { stored: initial, release: null as (() => void) | null };
  const engine = {
    subscribe: bus.subscribe,
    settings: {
      getUi: async () => ({ theme: state.stored, locale: 'system' }),
      setUi: async (patch: { theme?: string }) => {
        if (state.release === null && patch.theme !== undefined) {
          state.stored = patch.theme;
          return;
        }
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
        if (patch.theme !== undefined) state.stored = patch.theme;
      },
    },
  } as unknown as LearningEngine;
  return { selection: createThemeSelection(engine, initial), bus, state };
};

describe('createThemeSelection', () => {
  it('adopts a theme changed elsewhere (settings-changed ui)', async () => {
    const { selection, bus, state } = setup('light');
    state.stored = 'dark';
    bus.emit({ type: 'settings-changed', scope: 'ui' });
    await flush();
    expect(selection.saved.value).toBe('dark');
  });

  it('ignores other settings scopes', async () => {
    const { selection, bus, state } = setup('light');
    state.stored = 'dark';
    bus.emit({ type: 'settings-changed', scope: 'learning' });
    await flush();
    expect(selection.saved.value).toBe('light');
  });

  it('an outdated re-read does not undo a selection that is still being saved', async () => {
    const { selection, bus, state } = setup('light');
    state.release = () => undefined; // следующее сохранение ждёт
    const saving = selection.select('dark');
    expect(selection.saved.value).toBe('dark');
    // событие о старом изменении: чтение вернуло бы ещё `light`
    bus.emit({ type: 'settings-changed', scope: 'ui' });
    await flush();
    expect(selection.saved.value).toBe('dark');
    state.release?.();
    await saving;
    expect(selection.saved.value).toBe('dark');
  });
});
