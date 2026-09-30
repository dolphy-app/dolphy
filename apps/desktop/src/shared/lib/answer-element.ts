import type { ExerciseTaskDto } from '@dolphy-app/engine-contract';

const LOAD_TIMEOUT_MS = 5_000;

/**
 * Гарантирует, что custom element ввода ответа определён: подгружает
 * renderer-модуль расширения (`dolphy-ext://`), если тега ещё нет.
 */
export const ensureAnswerElement = async (
  task: ExerciseTaskDto,
): Promise<void> => {
  if (customElements.get(task.element)) return;
  await import(/* @vite-ignore */ task.rendererUrl);
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
};
