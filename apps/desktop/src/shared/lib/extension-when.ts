import { inject } from 'vue';
import type { InjectionKey } from 'vue';
import { WHEN_ROUTES, evaluateWhen, parseWhen } from '@dolphy-app/extension-api';
import type { WhenContext, WhenExpr } from '@dolphy-app/extension-api';

/** Источники значений ключей `when` расширений: читаются реактивно. */
export interface ExtensionWhenSources {
  /** Имя текущего маршрута (`route.name`). */
  route: () => string | symbol | null | undefined;
  /** Курс в фокусе: выбран один курс, а не «все». */
  courseActive: () => boolean;
  /** Язык окна после разрешения режима «как в системе»: `ru` или `en`. */
  locale: () => string;
  /** Текущая тема тёмная. */
  dark: () => boolean;
}

/**
 * Условия видимости (`when`) вкладов расширений в окне. Значения ключей
 * читаются из реактивных источников в момент вычисления: `matches` внутри
 * `computed`, `watch` или геттера реестра пересчитывается при смене маршрута,
 * курса в фокусе, языка и темы без перезагрузки окна.
 */
export interface ExtensionWhen {
  readonly context: WhenContext;
  /** `null` (нет условия) истинно; условие, которого окно не разбирает, ложно. */
  matches(when: string | null): boolean;
}

export const EXTENSION_WHEN_KEY: InjectionKey<ExtensionWhen> =
  Symbol('extension-when');

export const useExtensionWhen = (): ExtensionWhen => {
  const when = inject(EXTENSION_WHEN_KEY);
  if (!when) throw new Error('extension when is not provided');
  return when;
};

const ROUTES: readonly string[] = WHEN_ROUTES;

export const createExtensionWhen = (
  sources: ExtensionWhenSources,
): ExtensionWhen => {
  // разбор один раз на текст условия; `null` — окно условие не разбирает
  const parsed = new Map<string, WhenExpr | null>();
  const expressionOf = (text: string): WhenExpr | null => {
    if (parsed.has(text)) return parsed.get(text)!;
    let expr: WhenExpr | null = null;
    try {
      expr = parseWhen(text);
    } catch {
      // манифест проверяет то же `parseWhen`; расхождение версий скрывает вклад, а не показывает его
    }
    parsed.set(text, expr);
    return expr;
  };

  // геттеры: вычисление читает только те ключи, которые назвало условие
  const context: WhenContext = {
    get route() {
      const name = sources.route();
      return typeof name === 'string' && ROUTES.includes(name) ? name : '';
    },
    get 'course.active'() {
      return sources.courseActive();
    },
    get 'session.active'() {
      return sources.route() === 'session';
    },
    get locale() {
      return sources.locale();
    },
    get 'theme.dark'() {
      return sources.dark();
    },
  };

  return {
    context,
    matches: (when) => {
      if (when === null) return true;
      const expr = expressionOf(when);
      return expr !== null && evaluateWhen(expr, context);
    },
  };
};
