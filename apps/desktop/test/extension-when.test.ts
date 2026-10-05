import { shallowRef } from 'vue';
import { describe, expect, it } from 'vitest';
import { WHEN_ROUTES } from '@dolphy-app/extension-api';
import { ROUTE } from '@/shared/config/routes.ts';
import { createExtensionWhen } from '@/shared/lib/extension-when.ts';

const setup = () => {
  const route = shallowRef<string | symbol | null | undefined>('courses');
  const courseActive = shallowRef(false);
  const locale = shallowRef('ru');
  const dark = shallowRef(false);
  const when = createExtensionWhen({
    route: () => route.value,
    courseActive: () => courseActive.value,
    locale: () => locale.value,
    dark: () => dark.value,
  });
  return { route, courseActive, locale, dark, when };
};

describe('extension when', () => {
  it('the route values a manifest may name are exactly the route names of the window', () => {
    expect([...WHEN_ROUTES].sort()).toEqual(Object.values(ROUTE).sort());
  });

  it('no condition is always true', () => {
    expect(setup().when.matches(null)).toBe(true);
  });

  it('follows the route, the focused course, the language and the theme', () => {
    const { route, courseActive, locale, dark, when } = setup();
    const text =
      "route == 'courses' && course.active && locale == 'en' && theme.dark";

    expect(when.matches(text)).toBe(false);
    courseActive.value = true;
    locale.value = 'en';
    dark.value = true;
    expect(when.matches(text)).toBe(true);
    route.value = ROUTE.dailyPlan;
    expect(when.matches(text)).toBe(false);
    expect(when.matches("route == 'daily-plan'")).toBe(true);
  });

  it('session.active is true on the session route only', () => {
    const { route, when } = setup();
    expect(when.matches('session.active')).toBe(false);
    route.value = ROUTE.session;
    expect(when.matches('session.active')).toBe(true);
    expect(when.matches("route == 'session'")).toBe(true);
  });

  it('a route without a name or a symbol name is no known route', () => {
    const { route, when } = setup();
    for (const name of [undefined, null, Symbol('x')]) {
      route.value = name;
      expect(when.matches("route == 'courses'")).toBe(false);
      expect(when.matches("route != 'courses'")).toBe(true);
    }
  });

  it('a condition the window cannot parse hides the contribution, also when negated', () => {
    const { when } = setup();
    expect(when.matches("route == 'no-such-screen'")).toBe(false);
    expect(when.matches("!(route == 'no-such-screen')")).toBe(false);
    expect(when.matches('route ==')).toBe(false);
  });
});
