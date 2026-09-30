export interface ThemeSnapshot {
  /** Вычисленные CSS-переменные Vuetify (`--v-theme-*`, `--v-border-*` …). */
  variables: Record<string, string>;
  dark: boolean;
}

export interface ThemeSource {
  read(): ThemeSnapshot;
  /** Вызывает `listener` при смене темы; возвращает отписку. */
  subscribe(listener: () => void): () => void;
}

const THEME_STYLESHEET_ID = 'vuetify-theme-stylesheet';
const APP_ROOT_SELECTOR = '.v-application';

const collectNames = (rules: CSSRuleList, names: Set<string>) => {
  for (const rule of rules) {
    if ('style' in rule) {
      const { style } = rule as CSSStyleRule;
      for (let index = 0; index < style.length; index += 1) {
        const name = style.item(index);
        if (name.startsWith('--v-')) names.add(name);
      }
    }
    if ('cssRules' in rule)
      collectNames((rule as CSSGroupingRule).cssRules, names);
  }
};

/** Имена переменных, которые Vuetify объявил в своей таблице стилей темы. */
const themeVariableNames = (doc: Document): Set<string> => {
  const names = new Set<string>();
  const sheet = (
    doc.getElementById(THEME_STYLESHEET_ID) as HTMLStyleElement | null
  )?.sheet;
  if (sheet) collectNames(sheet.cssRules, names);
  return names;
};

const appRoot = (doc: Document): Element =>
  doc.querySelector(APP_ROOT_SELECTOR) ?? doc.documentElement;

/** Разрешённые значения переменных темы приложения в данный момент. */
export const readThemeSnapshot = (doc: Document): ThemeSnapshot => {
  const root = appRoot(doc);
  const style = doc.defaultView?.getComputedStyle(root);
  const variables: Record<string, string> = {};
  if (!style) return { variables, dark: false };
  for (const name of themeVariableNames(doc)) {
    const value = style.getPropertyValue(name).trim();
    if (value !== '') variables[name] = value;
  }
  return { variables, dark: style.colorScheme === 'dark' };
};

/** Тему приложения Vuetify переключает классом `v-theme--*` на корне приложения. */
export const createDomThemeSource = (doc: Document): ThemeSource => ({
  read: () => readThemeSnapshot(doc),
  subscribe: (listener) => {
    const view = doc.defaultView;
    if (!view) return () => undefined;
    const observer = new view.MutationObserver(listener);
    observer.observe(appRoot(doc), {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  },
});
