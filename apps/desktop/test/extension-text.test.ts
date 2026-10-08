// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import type { App } from 'vue';
import { createI18n } from 'vue-i18n';
import type { LocalizedText } from '@dolphy-app/extension-api';
import { useExtensionText } from '@/shared/lib/extension-text.ts';

const apps: App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = '';
});

const NAME = { en: 'Math formulas', ru: 'Математические формулы' };

/** The name and the optional text of one extension, as the settings list shows them. */
const mountRow = (info: { id: string; name: LocalizedText | null }) => {
  const i18n = createI18n({ legacy: false, locale: 'ru', messages: {} });
  const Row = defineComponent({
    setup() {
      const extensionText = useExtensionText();
      return () =>
        h(
          'p',
          `${extensionText.nameOf(info)}|${extensionText.ofOptional(info.name)}`,
        );
    },
  });
  const app = createApp(Row).use(i18n);
  apps.push(app);
  const host = document.createElement('div');
  document.body.append(host);
  app.mount(host);
  return { i18n, text: () => host.textContent };
};

describe('useExtensionText', () => {
  it('shows the name in the language of the window and follows a change of it', async () => {
    const { i18n, text } = mountRow({ id: 'dolphy.math', name: NAME });
    expect(text()).toBe('Математические формулы|Математические формулы');
    i18n.global.locale.value = 'en';
    await nextTick();
    expect(text()).toBe('Math formulas|Math formulas');
  });

  it('a plain string is shown in every language, no name — the id and no text', async () => {
    const plain = mountRow({ id: 'acme.plain', name: 'Plain' });
    plain.i18n.global.locale.value = 'en';
    await nextTick();
    expect(plain.text()).toBe('Plain|Plain');
    expect(mountRow({ id: 'acme.bare', name: null }).text()).toBe(
      'acme.bare|null',
    );
  });
});
