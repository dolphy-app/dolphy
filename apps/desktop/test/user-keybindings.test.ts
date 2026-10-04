import { describe, expect, it, vi } from 'vitest';
import type {
  KeybindingsPatch,
  KeybindingsSettingsDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import { createUserKeybindings } from '@/features/keybindings';
import { createEventBus } from './support/extensions-fakes.ts';

const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const entry = (key: string) => ({ key, when: null });

const setup = (initial: KeybindingsSettingsDto = { commands: {} }) => {
  const bus = createEventBus();
  const state = {
    stored: initial,
    release: null as (() => void) | null,
    fail: null as Error | null,
  };
  const engine = {
    subscribe: bus.subscribe,
    settings: {
      getKeybindings: vi.fn(async () => state.stored),
      setKeybindings: vi.fn(async (patch: KeybindingsPatch) => {
        if (state.fail !== null) throw state.fail;
        if (state.release !== null) {
          await new Promise<void>((resolve) => {
            const release = state.release;
            state.release = () => {
              release?.();
              resolve();
            };
          });
        }
        const commands = { ...state.stored.commands };
        for (const [key, entries] of Object.entries(patch)) {
          if (entries === null) delete commands[key];
          else commands[key] = entries;
        }
        state.stored = { commands };
        return state.stored;
      }),
    },
  } as unknown as LearningEngine;
  const store = createUserKeybindings(engine, initial.commands);
  return { store, bus, state, engine };
};

describe('createUserKeybindings', () => {
  it('starts with the stored set', () => {
    const { store } = setup({ commands: { 'app:a': [entry('Mod+1')] } });
    expect(store.stored.value).toEqual({ 'app:a': [entry('Mod+1')] });
  });

  it('re-reads after settings-changed for the keybindings scope only', async () => {
    const { store, bus, state, engine } = setup();
    state.stored = { commands: { 'app:a': [entry('Mod+2')] } };
    bus.emit({ type: 'settings-changed', scope: 'ui' });
    await flush();
    expect(engine.settings.getKeybindings).not.toHaveBeenCalled();
    bus.emit({ type: 'settings-changed', scope: 'keybindings' });
    await flush();
    expect(store.stored.value).toEqual({ 'app:a': [entry('Mod+2')] });
  });

  it('save applies the answer of the engine', async () => {
    const { store, engine } = setup();
    await store.save({ 'app:a': [entry('Mod+3')] });
    expect(engine.settings.setKeybindings).toHaveBeenCalledWith({
      'app:a': [entry('Mod+3')],
    });
    expect(store.stored.value).toEqual({ 'app:a': [entry('Mod+3')] });
    await store.save({ 'app:a': null });
    expect(store.stored.value).toEqual({});
  });

  it('an event during an own save does not trigger a stale re-read', async () => {
    const { store, bus, state, engine } = setup();
    state.release = () => undefined; // следующее сохранение ждёт
    const saving = store.save({ 'app:a': [entry('Mod+4')] });
    bus.emit({ type: 'settings-changed', scope: 'keybindings' });
    await flush();
    expect(engine.settings.getKeybindings).not.toHaveBeenCalled();
    state.release?.();
    await saving;
    expect(store.stored.value).toEqual({ 'app:a': [entry('Mod+4')] });
  });

  it('a rejected save keeps the stored set and rethrows the engine error with its details', async () => {
    const { store, state } = setup({
      commands: { 'app:a': [entry('Mod+1')] },
    });
    state.fail = Object.assign(new Error('conflict'), {
      details: { reason: 'conflict', command: 'app:a', other: 'app:b' },
    });
    await expect(store.save({ 'app:b': [entry('Mod+1')] })).rejects.toBe(
      state.fail,
    );
    expect(store.stored.value).toEqual({ 'app:a': [entry('Mod+1')] });
  });

  it('reconnected re-reads from the new engine', async () => {
    const { store, state } = setup();
    state.stored = { commands: { 'app:z': [entry('Mod+9')] } };
    await store.reconnected();
    expect(store.stored.value).toEqual({ 'app:z': [entry('Mod+9')] });
  });

  it('dispose stops listening', async () => {
    const { store, bus, engine } = setup();
    store.dispose();
    bus.emit({ type: 'settings-changed', scope: 'keybindings' });
    await flush();
    expect(engine.settings.getKeybindings).not.toHaveBeenCalled();
  });
});
