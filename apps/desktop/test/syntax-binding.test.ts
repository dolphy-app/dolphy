// @vitest-environment happy-dom
import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { DARK_THEME, LIGHT_THEME } from '@/shared/lib/builtin-themes.ts';
import { bindSyntaxPalette } from '@/shared/lib/syntax-binding.ts';
import { SYNTAX_SOURCES } from '@/shared/lib/syntax-palette.ts';

const current = (theme: typeof LIGHT_THEME) => ({
  colors: theme.colors as Record<string, unknown>,
  dark: theme.dark ?? false,
});

describe('bindSyntaxPalette', () => {
  it('publishes every --sh-* variable on the root right away', () => {
    const root = document.createElement('div');
    bindSyntaxPalette({ current: ref(current(LIGHT_THEME)) }, root);
    for (const token of Object.keys(SYNTAX_SOURCES)) {
      expect(root.style.getPropertyValue(`--sh-${token}`), token).toMatch(
        /^#[0-9a-f]{6}$/,
      );
    }
  });

  it('recolors when the theme changes, without waiting for a render', () => {
    const root = document.createElement('div');
    const theme = ref(current(LIGHT_THEME));
    bindSyntaxPalette({ current: theme }, root);
    const light = root.style.getPropertyValue('--sh-keyword');
    theme.value = current(DARK_THEME);
    const dark = root.style.getPropertyValue('--sh-keyword');
    expect(dark).not.toBe(light);
  });

  it('stops updating after the handle is stopped', () => {
    const root = document.createElement('div');
    const theme = ref(current(LIGHT_THEME));
    const stop = bindSyntaxPalette({ current: theme }, root);
    stop();
    const before = root.style.getPropertyValue('--sh-keyword');
    theme.value = current(DARK_THEME);
    expect(root.style.getPropertyValue('--sh-keyword')).toBe(before);
  });
});
