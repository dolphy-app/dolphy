import { reactive } from 'vue';
import type {
  ExerciseTaskDto,
  ExerciseTypeContributionDto,
} from '@dolphy-app/engine-contract';
import { moduleUrlOf } from './extension-url.ts';

const LOAD_TIMEOUT_MS = 5_000;

export type LoadAnswerModule = (url: string) => Promise<unknown>;

const importModule: LoadAnswerModule = (url) => import(/* @vite-ignore */ url);

/**
 * Тег → ревизия файлов, чей модуль определил его в этом окне.
 * `customElements.define` повторить нельзя: определённый элемент остаётся
 * прежним, пока окно не перезагружено (R7). Реактивна: по ней настройки
 * показывают баннер перезагрузки.
 */
const defined = reactive(new Map<string, string>());
const loading = new Map<string, Promise<void>>();

const load = async (
  task: ExerciseTaskDto,
  loadModule: LoadAnswerModule,
): Promise<void> => {
  await loadModule(moduleUrlOf(task));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`extension did not define <${task.element}>`)),
      LOAD_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([customElements.whenDefined(task.element), timeout]);
  } finally {
    clearTimeout(timer);
  }
  defined.set(task.element, task.revision);
};

/**
 * Гарантирует, что custom element ввода ответа определён: подгружает
 * renderer-модуль расширения (`dolphy-ext://`), если тега ещё нет. Определённый
 * тег не заменяется. Одновременные вызовы с одним тегом ждут одну загрузку.
 */
export const ensureAnswerElement = async (
  task: ExerciseTaskDto,
  loadModule: LoadAnswerModule = importModule,
): Promise<void> => {
  if (customElements.get(task.element)) return;
  let pending = loading.get(task.element);
  if (pending === undefined) {
    pending = load(task, loadModule).finally(() => {
      loading.delete(task.element);
    });
    loading.set(task.element, pending);
  }
  await pending;
};

/**
 * Теги, которые определены в окне модулем с другими файлами, чем у
 * действующего вида задания: обновление дойдёт до них только после
 * перезагрузки окна (R7). Изолированные виды не в счёте: у них свежая рамка.
 */
export const staleAnswerElements = (
  types: readonly Pick<
    ExerciseTypeContributionDto,
    'element' | 'isolated' | 'revision'
  >[],
): string[] => [
  ...new Set(
    types
      .filter(({ element, isolated, revision }) => {
        const current = defined.get(element);
        return !isolated && current !== undefined && current !== revision;
      })
      .map(({ element }) => element),
  ),
];
