import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useShortcutGroups } from '@/pages/settings/model/shortcuts.ts';
import { createCommandRegistry } from '@/shared/lib/command-registry.ts';
import type { CommandDescriptor } from '@/shared/lib/command-registry.ts';

const command = (
  key: string,
  override: Partial<CommandDescriptor> = {},
): CommandDescriptor => ({
  key,
  source: 'app',
  title: key,
  run: () => undefined,
  ...override,
});

const setup = () => {
  const registry = createCommandRegistry();
  const language = ref<'ru' | 'en'>('ru');
  registry.register(
    command('app:palette.open', {
      title: () => (language.value === 'ru' ? 'Открыть палитру' : 'Open'),
      category: () => (language.value === 'ru' ? 'Приложение' : 'App'),
      keybinding: 'Mod+K',
      listed: false,
    }),
  );
  registry.register(
    command('app:go:courses', {
      title: () => (language.value === 'ru' ? 'Курсы' : 'Courses'),
      category: () => (language.value === 'ru' ? 'Переход' : 'Go'),
      keybinding: 'Mod+2',
    }),
  );
  registry.register(command('app:theme:dark', { category: 'Тема' }));
  return {
    registry,
    language,
    other: useShortcutGroups(registry),
  };
};

describe('useShortcutGroups', () => {
  it('lists only commands with an active keybinding, grouped by category, including ones hidden from the palette', () => {
    const { other } = setup();
    expect(other.value).toEqual([
      {
        category: 'Приложение',
        rows: [
          {
            key: 'app:palette.open',
            title: 'Открыть палитру',
            keybinding: 'Mod+K',
          },
        ],
      },
      {
        category: 'Переход',
        rows: [{ key: 'app:go:courses', title: 'Курсы', keybinding: 'Mod+2' }],
      },
    ]);
  });

  it('excludes extension keybinding hints', () => {
    const { registry, other } = setup();
    registry.register(
      command('extension:acme:go', {
        source: 'extension',
        keybinding: 'Mod+Shift+G',
        category: 'Acme',
      }),
    );
    expect(other.value.map(({ category }) => category)).toEqual([
      'Приложение',
      'Переход',
    ]);
  });

  it('follows the locale and the registry', () => {
    const { registry, language, other } = setup();
    language.value = 'en';
    expect(other.value.map(({ category }) => category)).toEqual(['App', 'Go']);
    expect(other.value[1]?.rows[0]?.title).toBe('Courses');
    const dispose = registry.register(
      command('app:go:graph', {
        category: () => 'Go',
        title: 'Graph',
        keybinding: 'Mod+3',
      }),
    );
    expect(other.value[1]?.rows.map(({ keybinding }) => keybinding)).toEqual([
      'Mod+2',
      'Mod+3',
    ]);
    dispose();
    expect(other.value[1]?.rows).toHaveLength(1);
  });

  it('commands without a category come last', () => {
    const { registry, other } = setup();
    registry.register(command('app:z', { keybinding: 'Mod+9' }));
    registry.register(
      command('app:y', { keybinding: 'Mod+8', category: 'Тема' }),
    );
    expect(other.value.map(({ category }) => category)).toEqual([
      'Приложение',
      'Переход',
      'Тема',
      undefined,
    ]);
  });
});
