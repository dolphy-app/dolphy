import { targetSelector } from './tours.ts';

/** Сколько ждём появления цели шага после перехода на страницу. */
export const TARGET_TIMEOUT_MS = 2000;

const visible = (element: Element): boolean =>
  element.getClientRects().length > 0;

/**
 * Ждёт видимый элемент с `data-tour="<target>"`: страница после перехода и
 * загрузка данных (карточки курсов) занимают несколько кадров.
 */
export const findTarget = (
  target: string,
  timeoutMs = TARGET_TIMEOUT_MS,
): Promise<HTMLElement | null> =>
  new Promise((resolve) => {
    const deadline = performance.now() + timeoutMs;
    const look = () => {
      const element = document.querySelector<HTMLElement>(
        targetSelector(target),
      );
      if (element !== null && visible(element)) resolve(element);
      else if (performance.now() >= deadline) resolve(null);
      else requestAnimationFrame(look);
    };
    look();
  });
