// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { ROUTE } from '@/shared/config/routes.ts';
import { createContextKeys, pageOfRoute } from '@/shared/lib/context-keys.ts';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('pageOfRoute', () => {
  it.each([
    [ROUTE.dailyPlan, 'dailyPlan'],
    [ROUTE.courses, 'courses'],
    [ROUTE.graph, 'graph'],
    [ROUTE.session, 'session'],
    [ROUTE.extensionPanel, 'extension'],
    [ROUTE.settings, 'settings'],
    [ROUTE.settingsLearning, 'settings'],
    [ROUTE.settingsShortcuts, 'settings'],
    [ROUTE.settingsAbout, 'settings'],
  ])('маршрут %s — раздел %s', (route, page) => {
    expect(pageOfRoute(route)).toBe(page);
  });

  it('маршрут без раздела и неизвестное имя — undefined', () => {
    expect(pageOfRoute(ROUTE.placement)).toBeUndefined();
    expect(pageOfRoute(undefined)).toBeUndefined();
    expect(pageOfRoute(null)).toBeUndefined();
    expect(pageOfRoute(Symbol('x'))).toBeUndefined();
    expect(pageOfRoute('constructor')).toBeUndefined();
  });
});

describe('createContextKeys', () => {
  it.each([
    ['mac', [true, false, false]],
    ['windows', [false, true, false]],
    ['linux', [false, false, true]],
  ] as const)('платформа %s', (platform, [mac, windows, linux]) => {
    const lookup = createContextKeys(platform, document).lookup(null);
    expect(lookup('platform')).toBe(platform);
    expect([lookup('isMac'), lookup('isWindows'), lookup('isLinux')]).toEqual([
      mac,
      windows,
      linux,
    ]);
  });

  it('page, inSession и paletteOpen — значения приложения, читаются в момент вызова', () => {
    const keys = createContextKeys('linux', document);
    expect(keys.lookup(null)('page')).toBeUndefined();
    keys.page.value = 'graph';
    keys.inSession.value = true;
    keys.paletteOpen.value = true;
    const lookup = keys.lookup(null);
    expect([
      lookup('page'),
      lookup('inSession'),
      lookup('paletteOpen'),
    ]).toEqual(['graph', true, true]);
  });

  it.each([
    ['<input id="t">', true],
    ['<textarea id="t"></textarea>', true],
    ['<select id="t"></select>', true],
    ['<div id="t" contenteditable="true"></div>', true],
    ['<div contenteditable="true"><span id="t">x</span></div>', true],
    ['<button id="t"></button>', false],
  ])('inputFocus по цели события: %s → %s', (html, expected) => {
    document.body.innerHTML = html;
    const keys = createContextKeys('linux', document);
    expect(keys.lookup(document.getElementById('t'))('inputFocus')).toBe(
      expected,
    );
    expect(keys.lookup(null)('inputFocus')).toBe(false);
  });

  it.each([
    ['<div class="v-dialog v-overlay--active"></div>', true],
    ['<div class="v-menu v-overlay--active"></div>', true],
    ['<div role="dialog" aria-modal="true"></div>', true],
    ['<div class="v-snackbar v-overlay--active"></div>', false],
    // закрывающийся диалог Vuetify ещё в DOM, но уже не активен
    [
      '<div class="v-overlay v-dialog" role="dialog" aria-modal="true"></div>',
      false,
    ],
    ['<div class="v-dialog"></div>', false],
  ])('modalOpen по DOM в момент нажатия: %s → %s', (html, expected) => {
    const keys = createContextKeys('linux', document);
    expect(keys.lookup(null)('modalOpen')).toBe(false);
    document.body.innerHTML = html;
    expect(keys.lookup(null)('modalOpen')).toBe(expected);
  });

  it('неизвестный ключ — undefined (ложь в условии)', () => {
    expect(createContextKeys('linux', document).lookup(null)('nope')).toBe(
      undefined,
    );
  });
});
