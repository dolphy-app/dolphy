import type { App } from 'vue';
import { createVuetify } from 'vuetify';
import type { LocaleInstance, ThemeInstance } from 'vuetify';
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg';
import { en, ru } from 'vuetify/locale';
import {
  FRAME_THEME_NAME,
  readFrameLocale,
  readFrameTheme,
} from './frame-theme.ts';

/** What the kit uses of a Vuetify instance. */
export interface FrameVuetify {
  install(app: App): void;
  readonly theme: ThemeInstance;
  readonly locale: LocaleInstance;
}

const createInstance = (doc: Document): FrameVuetify => {
  const vuetify = createVuetify({
    theme: {
      defaultTheme: FRAME_THEME_NAME,
      themes: { [FRAME_THEME_NAME]: readFrameTheme(doc) },
    },
    locale: {
      locale: readFrameLocale(doc),
      fallback: 'en',
      messages: { en, ru },
    },
    // an SVG icon set: a font from `@mdi/font` is not in the frame, and CSP forbids loading one
    icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  });
  const view = doc.defaultView;
  if (view !== null) {
    // the frame runtime changes the variables (`style`) and `lang` on `<html>` when the app theme or language changes;
    // a class of `<html>` is how a page without the frame runtime (Storybook) switches its theme
    new view.MutationObserver(() => {
      Object.assign(vuetify.theme.themes.value, {
        [FRAME_THEME_NAME]: readFrameTheme(doc),
      });
      vuetify.locale.current.value = readFrameLocale(doc);
    }).observe(doc.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'lang', 'class'],
    });
  }
  return vuetify;
};

const instances = new WeakMap<Document, FrameVuetify>();

/** One Vuetify per frame document: every mounted component reads the same theme and language. */
export const vuetifyOf = (doc: Document): FrameVuetify => {
  let instance = instances.get(doc);
  if (instance === undefined) {
    instance = createInstance(doc);
    instances.set(doc, instance);
  }
  return instance;
};
