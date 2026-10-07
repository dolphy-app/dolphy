import { ref, shallowRef } from 'vue';
import { describe, expect, it } from 'vitest';
import type { ThemeDefinition } from 'vuetify';
import { bindExtensionThemes } from '@/shared/lib/theme-registry.ts';
import type { ThemeRegistry } from '@/shared/lib/theme-registry.ts';
import type { ClientTheme } from '@/shared/lib/extension-clients.ts';

const theme = (id: string, dark = false): ClientTheme => ({
  kind: 'theme',
  key: `${id}:1:1`,
  id,
  extensionId: id,
  label: id,
  dark,
  colors: { primary: '#123456' },
  variables: {},
});

/** Реестр Vuetify: `change` на неизвестную тему — ошибка, как предупреждение Vuetify. */
const createRegistry = () => {
  const themes = ref<Record<string, ThemeDefinition>>({
    light: { dark: false },
    dark: { dark: true },
  });
  const changes: string[] = [];
  const registry: ThemeRegistry = {
    themes,
    change: (name) => {
      if (name !== 'system' && !(name in themes.value)) {
        throw new Error(`theme ${name} is not registered`);
      }
      changes.push(name);
    },
  };
  return { registry, themes, changes };
};

describe('bindExtensionThemes', () => {
  it('registers a contributed theme before switching to it', () => {
    const { registry, themes, changes } = createRegistry();
    const saved = shallowRef('acme.midnight');
    bindExtensionThemes(registry, saved, () => [theme('acme.midnight', true)]);
    expect(Object.keys(themes.value)).toContain('ext__acme__midnight');
    expect(themes.value['ext__acme__midnight']?.dark).toBe(true);
    expect(changes).toEqual(['ext__acme__midnight']);
  });

  it('falls back to system when the active theme disappears and removes it from the registry', () => {
    const { registry, themes, changes } = createRegistry();
    const saved = shallowRef('acme.midnight');
    const contributed = shallowRef([theme('acme.midnight')]);
    bindExtensionThemes(registry, saved, () => contributed.value);
    contributed.value = [];
    expect(changes.at(-1)).toBe('system');
    expect(themes.value['ext__acme__midnight']).toBeUndefined();
    // сохранённый выбор не тронут
    expect(saved.value).toBe('acme.midnight');
  });

  it('returns to the saved theme when the extension returns', () => {
    const { registry, changes } = createRegistry();
    const saved = shallowRef('acme.midnight');
    const contributed = shallowRef([theme('acme.midnight')]);
    bindExtensionThemes(registry, saved, () => contributed.value);
    contributed.value = [];
    contributed.value = [theme('acme.midnight')];
    expect(changes.slice(-2)).toEqual(['system', 'ext__acme__midnight']);
  });

  it('applies a selection change and keeps unrelated themes', () => {
    const { registry, themes, changes } = createRegistry();
    const saved = shallowRef('light');
    bindExtensionThemes(registry, saved, () => [
      theme('acme.a'),
      theme('acme.b'),
    ]);
    saved.value = 'acme.b';
    saved.value = 'dark';
    expect(changes).toEqual(['light', 'ext__acme__b', 'dark']);
    expect(Object.keys(themes.value).sort()).toEqual([
      'dark',
      'ext__acme__a',
      'ext__acme__b',
      'light',
    ]);
  });

  it('drops only the removed theme and updates a changed one in place', () => {
    const { registry, themes } = createRegistry();
    const saved = shallowRef('system');
    const contributed = shallowRef([theme('acme.a'), theme('acme.b')]);
    bindExtensionThemes(registry, saved, () => contributed.value);
    contributed.value = [
      { ...theme('acme.a'), colors: { primary: '#ff0000' } },
    ];
    expect(Object.keys(themes.value).sort()).toEqual([
      'dark',
      'ext__acme__a',
      'light',
    ]);
    expect(themes.value['ext__acme__a']?.colors?.['primary']).toBe('#ff0000');
  });

  it('shows system until the saved theme is registered, then applies it', () => {
    const { registry, changes } = createRegistry();
    const contributed = shallowRef<ClientTheme[]>([]);
    bindExtensionThemes(
      registry,
      shallowRef('acme.midnight'),
      () => contributed.value,
    );
    expect(changes).toEqual(['system']);
    contributed.value = [theme('acme.midnight')];
    expect(changes).toEqual(['system', 'ext__acme__midnight']);
  });
});
