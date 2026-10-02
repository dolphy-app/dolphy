import { effectScope, nextTick, ref, watchEffect } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  createCommandRegistry,
  syncCommands,
} from '@/shared/lib/command-registry.ts';
import type { CommandDescriptor } from '@/shared/lib/command-registry.ts';

const descriptor = (
  key: string,
  override: Partial<CommandDescriptor> = {},
): CommandDescriptor => ({
  key,
  source: 'app',
  title: key,
  run: () => undefined,
  ...override,
});

describe('createCommandRegistry', () => {
  it('registers, lists in registration order and disposes', () => {
    const registry = createCommandRegistry();
    const disposeA = registry.register(descriptor('app:a'));
    registry.register(descriptor('app:b'));
    expect(registry.list.value.map(({ key }) => key)).toEqual([
      'app:a',
      'app:b',
    ]);
    disposeA();
    expect(registry.list.value.map(({ key }) => key)).toEqual(['app:b']);
  });

  it('throws on a duplicate key and keeps the first entry', () => {
    const registry = createCommandRegistry();
    registry.register(descriptor('app:a', { title: 'first' }));
    expect(() =>
      registry.register(descriptor('app:a', { title: 'second' })),
    ).toThrow(/already registered/);
    expect(registry.list.value.map(({ title }) => title)).toEqual(['first']);
  });

  it('a stale dispose does not remove a newer entry with the same key', () => {
    const registry = createCommandRegistry();
    const dispose = registry.register(descriptor('app:a', { title: 'old' }));
    dispose();
    registry.register(descriptor('app:a', { title: 'new' }));
    dispose();
    expect(registry.list.value.map(({ title }) => title)).toEqual(['new']);
  });

  it('validates the keybinding of app commands only', () => {
    const registry = createCommandRegistry();
    expect(() =>
      registry.register(descriptor('app:a', { keybinding: 'Ctrl+K' })),
    ).toThrow(/invalid keybinding/);
    registry.register(
      descriptor('extension:x:a', {
        source: 'extension',
        keybinding: 'any hint',
      }),
    );
    expect(registry.list.value[0]?.keybinding).toBe('any hint');
  });

  it('list is reactive to registration and to resolved values', async () => {
    const registry = createCommandRegistry();
    const locale = ref('ru');
    const checked = ref(false);
    const enabled = ref(true);
    registry.register(
      descriptor('app:a', {
        title: () => (locale.value === 'ru' ? 'Курсы' : 'Courses'),
        category: () => (locale.value === 'ru' ? 'Переход' : 'Go'),
        checked: () => checked.value,
        enabled,
      }),
    );
    const seen: string[] = [];
    const scope = effectScope();
    scope.run(() =>
      watchEffect(() => {
        const [command] = registry.list.value;
        seen.push(
          `${command?.title}|${command?.category}|${command?.checked}|${command?.enabled}`,
        );
      }),
    );
    locale.value = 'en';
    checked.value = true;
    enabled.value = false;
    await nextTick();
    expect(seen.at(-1)).toBe('Courses|Go|true|false');
    registry.register(descriptor('app:b'));
    await nextTick();
    expect(seen.at(-1)).toBe('Courses|Go|true|false');
    scope.stop();
  });

  it('runs the handler of the entry', async () => {
    const registry = createCommandRegistry();
    const run = vi.fn();
    registry.register(descriptor('app:a', { run }));
    await registry.list.value[0]?.run();
    expect(run).toHaveBeenCalledOnce();
  });
});

describe('syncCommands', () => {
  const setup = () => {
    const registry = createCommandRegistry();
    const wanted = ref<{ id: string; label: string }[]>([]);
    const stop = syncCommands(registry, () =>
      wanted.value.map(({ id, label }) => ({
        descriptor: descriptor(`app:theme:${id}`, { title: label }),
        revision: label,
      })),
    );
    const titles = () => registry.list.value.map(({ title }) => title);
    return { registry, wanted, stop, titles };
  };

  it('adds, updates and removes entries as the source changes', () => {
    const { wanted, titles } = setup();
    wanted.value = [{ id: 'a', label: 'A' }];
    expect(titles()).toEqual(['A']);
    wanted.value = [
      { id: 'a', label: 'A2' },
      { id: 'b', label: 'B' },
    ];
    expect(titles()).toEqual(['A2', 'B']);
    wanted.value = [{ id: 'b', label: 'B' }];
    expect(titles()).toEqual(['B']);
  });

  it('keeps an unchanged entry registered (same descriptor)', () => {
    const { registry, wanted } = setup();
    wanted.value = [{ id: 'a', label: 'A' }];
    const before = registry.list.value[0];
    wanted.value = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ];
    expect(registry.list.value[0]?.run).toBe(before?.run);
    expect(registry.list.value).toHaveLength(2);
  });

  it('stop removes everything and ignores later changes', () => {
    const { wanted, stop, titles } = setup();
    wanted.value = [{ id: 'a', label: 'A' }];
    stop();
    expect(titles()).toEqual([]);
    wanted.value = [{ id: 'b', label: 'B' }];
    expect(titles()).toEqual([]);
  });
});
