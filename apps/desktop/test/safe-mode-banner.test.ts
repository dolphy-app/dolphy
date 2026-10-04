import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  LearningEngine,
  SafeModeStatusDto,
} from '@dolphy-app/engine-contract';
import { bannerOf, useSafeMode } from '@/app/layouts/safe-mode.ts';
import {
  createEventBus,
  diagnosticsDto,
  flush,
} from './support/extensions-fakes.ts';

const status = (override: Partial<SafeModeStatusDto>): SafeModeStatusDto => ({
  active: true,
  persisted: false,
  forcedBy: null,
  ...override,
});

describe('bannerOf', () => {
  it('режим выключен или ещё не прочитан — баннера нет', () => {
    expect(bannerOf(null)).toBeNull();
    expect(bannerOf(status({ active: false }))).toBeNull();
  });

  it('включён настройкой — баннер с кнопкой «Выключить»', () => {
    expect(bannerOf(status({ persisted: true }))).toEqual({
      kind: 'persisted',
      canDisable: true,
    });
  });

  it.each(['flag', 'env'] as const)(
    'задан запуском (%s) — без кнопки, даже если включён и настройкой',
    (forcedBy) => {
      expect(bannerOf(status({ forcedBy }))).toEqual({
        kind: forcedBy,
        canDisable: false,
      });
      expect(bannerOf(status({ forcedBy, persisted: true }))).toEqual({
        kind: forcedBy,
        canDisable: false,
      });
    },
  );
});

describe('useSafeMode', () => {
  /** Состояние движка меняется `setSafeMode`, как настоящий. */
  const createEngine = (initial: SafeModeStatusDto, fail = false) => {
    const bus = createEventBus();
    const state = {
      current: initial,
      reads: 0,
      writes: [] as boolean[],
      readFails: false,
    };
    const engine = {
      subscribe: bus.subscribe,
      extensions: {
        diagnostics: async () => {
          state.reads += 1;
          if (state.readFails) throw new Error('engine is down');
          return diagnosticsDto({ safeMode: state.current });
        },
        setSafeMode: async (enabled: boolean) => {
          state.writes.push(enabled);
          if (fail) throw new Error('disk is full');
          state.current = status({
            active: enabled || state.current.forcedBy !== null,
            persisted: enabled,
          });
        },
      },
    } as unknown as LearningEngine;
    return { engine, bus, state };
  };
  const mount = (engine: LearningEngine) =>
    effectScope().run(() => useSafeMode(engine))!;

  it('баннер появляется по состоянию движка', async () => {
    const { engine } = createEngine(status({ persisted: true }));
    const model = mount(engine);
    expect(model.banner.value).toBeNull();
    await flush();
    expect(model.banner.value).toEqual({ kind: 'persisted', canDisable: true });
  });

  it('«Выключить»: расширения возвращаются сразу, баннер исчезает без перезапуска', async () => {
    const { engine, state } = createEngine(status({ persisted: true }));
    const model = mount(engine);
    await flush();

    await model.disable();

    expect(state.writes).toEqual([false]);
    expect(model.banner.value).toBeNull();
    expect(model.failed.value).toBe(false);
    expect(model.disabling.value).toBe(false);
  });

  it('отказ движка оставляет баннер и сообщает об ошибке; повтор возможен', async () => {
    const { engine, state } = createEngine(status({ persisted: true }), true);
    const model = mount(engine);
    await flush();

    await model.disable();

    expect(model.banner.value).toEqual({ kind: 'persisted', canDisable: true });
    expect(model.failed.value).toBe(true);
    await model.disable();
    expect(state.writes).toEqual([false, false]);
  });

  it('изменение настроек расширений и набора вкладов перечитывает состояние; прочие события — нет', async () => {
    const { engine, bus, state } = createEngine(status({ active: false }));
    const model = mount(engine);
    await flush();
    expect(model.banner.value).toBeNull();

    // режим включили в настройках (например, в другом окне)
    state.current = status({ persisted: true });
    bus.emit({ type: 'settings-changed', scope: 'extensions' });
    await flush();
    expect(model.banner.value).toEqual({ kind: 'persisted', canDisable: true });

    const reads = state.reads;
    bus.emit({ type: 'settings-changed', scope: 'ui' });
    bus.emit({ type: 'extensions-changed' });
    await flush();
    expect(state.reads).toBe(reads);

    state.current = status({ active: false });
    bus.emit({ type: 'contributions-changed', generation: 1 });
    await flush();
    expect(model.banner.value).toBeNull();
  });

  it('сбой чтения не включает баннер и не затирает прежнее состояние', async () => {
    const { engine, bus, state } = createEngine(status({ persisted: true }));
    const model = mount(engine);
    await flush();
    state.readFails = true;
    bus.emit({ type: 'contributions-changed', generation: 2 });
    await flush();
    expect(model.banner.value).toEqual({ kind: 'persisted', canDisable: true });
  });
});
