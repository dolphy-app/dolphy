import { effectScope, ref, shallowRef } from 'vue';
import { createI18n } from 'vue-i18n';
import { describe, expect, it, vi } from 'vitest';
import type {
  LocaleMode,
  ThemeContributionDto,
} from '@dolphy-app/engine-contract';
import { en as appEn } from '@/app/i18n/en.ts';
import { ru as appRu } from '@/app/i18n/ru.ts';
import { registerAppCommands } from '@/features/app-commands/model/app-commands.ts';
import { messages as appCommandsMessages } from '@/features/app-commands/i18n/index.ts';
import { ROUTE } from '@/shared/config/routes.ts';
import { sharedMessages } from '@/shared/i18n';
import { createCommandRegistry } from '@/shared/lib/command-registry.ts';
import { messages as settingsMessages } from '@/pages/settings/i18n/index.ts';
import { russianPluralRule } from '@/shared/i18n/plural.ts';

const theme = (id: string, label: string): ThemeContributionDto => ({
  id,
  extensionId: id.split('.').slice(0, 2).join('.'),
  label,
  dark: true,
  colors: {},
  variables: {},
});

const setup = () => {
  const i18n = createI18n({
    legacy: false,
    locale: 'ru',
    fallbackLocale: 'en',
    messages: {
      ru: {
        ...sharedMessages.ru,
        ...appRu,
        ...appCommandsMessages.ru,
        ...settingsMessages.ru,
      },
      en: {
        ...sharedMessages.en,
        ...appEn,
        ...appCommandsMessages.en,
        ...settingsMessages.en,
      },
    },
    pluralRules: { ru: russianPluralRule },
  });
  const registry = createCommandRegistry();
  const push = vi.fn(async () => undefined);
  const saved = ref('system');
  const localeSaved = ref<LocaleMode>('system');
  const themes = shallowRef<readonly ThemeContributionDto[]>([]);
  const selectTheme = vi.fn(async (id: string) => {
    saved.value = id;
  });
  const selectLocale = vi.fn(async (mode: LocaleMode) => {
    localeSaved.value = mode;
    if (mode !== 'system') i18n.global.locale.value = mode;
  });
  const reportFailure = vi.fn();
  const openPalette = vi.fn();
  const scope = effectScope();
  const stop = scope.run(() =>
    registerAppCommands({
      registry,
      openPalette,
      router: { push },
      t: i18n.global.t as never,
      themeSelection: { saved, select: selectTheme },
      localeSelection: { saved: localeSaved, select: selectLocale },
      themes: () => themes.value,
      extensionText: (value) => value,
      reportFailure,
    }),
  )!;
  const find = (key: string) =>
    registry.list.value.find((command) => command.key === key);
  const titles = (prefix: string) =>
    registry.list.value
      .filter(({ key }) => key.startsWith(prefix))
      .map(({ title }) => title);
  return {
    registry,
    push,
    saved,
    localeSaved,
    themes,
    selectTheme,
    selectLocale,
    reportFailure,
    openPalette,
    stop,
    find,
    titles,
    i18n,
  };
};

describe('команды приложения: переходы', () => {
  it.each([
    ['app:go:dailyPlan', ROUTE.dailyPlan, 'Перейти: План дня'],
    ['app:go:courses', ROUTE.courses, 'Перейти: Курсы'],
    ['app:go:settings', ROUTE.settings, 'Перейти: Настройки'],
    [
      'app:go:settingsLearning',
      ROUTE.settingsLearning,
      'Перейти: Настройки — Обучение',
    ],
    [
      'app:go:settingsLibrary',
      ROUTE.settingsLibrary,
      'Перейти: Настройки — Библиотека',
    ],
    [
      'app:go:settingsAppearance',
      ROUTE.settingsAppearance,
      'Перейти: Настройки — Внешний вид',
    ],
    [
      'app:go:settingsExtensions',
      ROUTE.settingsExtensions,
      'Перейти: Настройки — Расширения',
    ],
    [
      'app:go:settingsAbout',
      ROUTE.settingsAbout,
      'Перейти: Настройки — О движке',
    ],
  ])('%s ведёт на маршрут %s', async (key, route, title) => {
    const { find, push } = setup();
    const command = find(key);
    expect(command).toMatchObject({
      source: 'app',
      title,
      category: 'Переход',
      caption: undefined,
    });
    await command?.run();
    expect(push).toHaveBeenCalledExactlyOnceWith({ name: route });
  });

  it('сочетания: Mod+K, Mod+, и Mod+1..3 — остальные команды без сочетаний', () => {
    const { registry } = setup();
    const bound = Object.fromEntries(
      registry.list.value
        .filter(({ keybinding }) => keybinding !== undefined)
        .map(({ key, keybinding }) => [key, keybinding]),
    );
    expect(bound).toEqual({
      'app:palette.open': 'Mod+K',
      'app:go:dailyPlan': 'Mod+1',
      'app:go:courses': 'Mod+2',
      'app:go:settings': 'Mod+,',
    });
  });

  it('«Открыть палитру команд» — команда приложения, скрытая из палитры; запускает открытие палитры', async () => {
    const { find, openPalette } = setup();
    const command = find('app:palette.open');
    expect(command).toMatchObject({
      source: 'app',
      title: 'Открыть палитру команд',
      category: 'Приложение',
      listed: false,
    });
    await command?.run();
    expect(openPalette).toHaveBeenCalledOnce();
  });

  it('сбой перехода уходит в уведомление, а не в исключение', async () => {
    const { find, push, reportFailure } = setup();
    push.mockRejectedValueOnce(new Error('boom'));
    await find('app:go:courses')?.run();
    expect(reportFailure).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
  });
});

describe('команды приложения: темы', () => {
  it('встроенные темы, затем темы расширений; названия расширений — данные', () => {
    const { titles, themes } = setup();
    expect(titles('app:theme:')).toEqual([
      'Тема: Как в системе',
      'Тема: Светлая',
      'Тема: Тёмная',
    ]);
    themes.value = [theme('acme.midnight', 'Полночь')];
    expect(titles('app:theme:')).toEqual([
      'Тема: Как в системе',
      'Тема: Светлая',
      'Тема: Тёмная',
      'Тема: Полночь',
    ]);
  });

  it('команда темы расширения появляется и пропадает вместе с вкладом', () => {
    const { find, themes } = setup();
    themes.value = [theme('acme.midnight', 'Полночь')];
    expect(find('app:theme:acme.midnight')).toBeDefined();
    themes.value = [
      theme('acme.midnight', 'Полночь+'),
      theme('acme.dawn', 'Рассвет'),
    ];
    expect(find('app:theme:acme.midnight')?.title).toBe('Тема: Полночь+');
    expect(find('app:theme:acme.dawn')).toBeDefined();
    themes.value = [];
    expect(find('app:theme:acme.midnight')).toBeUndefined();
    expect(find('app:theme:acme.dawn')).toBeUndefined();
    expect(find('app:theme:dark')).toBeDefined();
  });

  it('команда выбирает тему через API выбора темы', async () => {
    const { find, selectTheme, themes } = setup();
    themes.value = [theme('acme.midnight', 'Полночь')];
    await find('app:theme:dark')?.run();
    await find('app:theme:acme.midnight')?.run();
    expect(selectTheme.mock.calls).toEqual([['dark'], ['acme.midnight']]);
  });

  it('checked следует за выбором; пропавшая тема расширения показывает «Как в системе»', async () => {
    const { find, saved, themes } = setup();
    themes.value = [theme('acme.midnight', 'Полночь')];
    expect(find('app:theme:system')?.checked).toBe(true);
    expect(find('app:theme:dark')?.checked).toBe(false);
    await find('app:theme:acme.midnight')?.run();
    expect(find('app:theme:acme.midnight')?.checked).toBe(true);
    expect(find('app:theme:system')?.checked).toBe(false);
    themes.value = [];
    expect(saved.value).toBe('acme.midnight');
    expect(find('app:theme:system')?.checked).toBe(true);
    themes.value = [theme('acme.midnight', 'Полночь')];
    expect(find('app:theme:acme.midnight')?.checked).toBe(true);
  });

  it('сбой сохранения темы — в уведомление', async () => {
    const { find, selectTheme, reportFailure } = setup();
    selectTheme.mockRejectedValueOnce(new Error('disk full'));
    await find('app:theme:light')?.run();
    expect(reportFailure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'disk full' }),
    );
  });
});

describe('команды приложения: язык', () => {
  it('три варианта; названия языков не переводятся, «Как в системе» — переводится', () => {
    const { titles, i18n } = setup();
    expect(titles('app:locale:')).toEqual([
      'Язык: Как в системе',
      'Язык: Русский',
      'Язык: English',
    ]);
    i18n.global.locale.value = 'en';
    expect(titles('app:locale:')).toEqual([
      'Language: System default',
      'Language: Русский',
      'Language: English',
    ]);
  });

  it('команда выбирает язык через API выбора языка; checked следует за выбором', async () => {
    const { find, selectLocale } = setup();
    expect(find('app:locale:system')?.checked).toBe(true);
    await find('app:locale:en')?.run();
    expect(selectLocale).toHaveBeenCalledExactlyOnceWith('en');
    expect(find('app:locale:en')?.checked).toBe(true);
    expect(find('app:locale:system')?.checked).toBe(false);
  });

  it('смена языка пересчитывает названия и категории всех команд без повторной регистрации', async () => {
    const { find, registry } = setup();
    const before = registry.list.value.length;
    await find('app:locale:en')?.run();
    expect(find('app:go:courses')).toMatchObject({
      title: 'Go to: Courses',
      category: 'Navigation',
    });
    expect(find('app:theme:dark')?.title).toBe('Theme: Dark');
    expect(registry.list.value).toHaveLength(before);
  });

  it('сбой сохранения языка — в уведомление', async () => {
    const { find, selectLocale, reportFailure } = setup();
    selectLocale.mockRejectedValueOnce(new Error('disk full'));
    await find('app:locale:ru')?.run();
    expect(reportFailure).toHaveBeenCalledOnce();
  });
});

describe('команды приложения: снятие', () => {
  it('снятие убирает все записи, в том числе динамические темы расширений', () => {
    const { registry, stop, themes } = setup();
    themes.value = [theme('acme.midnight', 'Полночь')];
    stop();
    expect(registry.list.value).toEqual([]);
    themes.value = [];
    themes.value = [theme('acme.dawn', 'Рассвет')];
    expect(registry.list.value).toEqual([]);
  });
});
