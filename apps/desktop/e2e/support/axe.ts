import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { Frame, Page } from 'playwright-core';

export interface AxeViolation {
  id: string;
  impact: string | null;
  nodes: string[];
}

let source: Promise<string> | null = null;

/** Исходник `axe-core`, читается один раз на процесс. */
const axeSource = (): Promise<string> => {
  source ??= readFile(
    createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
    'utf8',
  );
  return source;
};

/**
 * Проверка доступности текущего экрана движком `axe-core` (без сети: скрипт
 * подставляется в страницу). Возвращает нарушения; пустой список — чисто.
 * `include` — селектор области (диалоги Vuetify лежат в `body`, а не в корне приложения).
 * `page` может быть рамкой (`Frame`, например панелью расширения). `impacts` оставляет
 * только нарушения указанной важности.
 */
export const runAxe = async (
  page: Page | Frame,
  options: { include?: string; impacts?: readonly string[] } = {},
): Promise<AxeViolation[]> => {
  await page.evaluate(await axeSource());
  const violations = await page.evaluate(async (include) => {
    const context = include === undefined ? document : { include: [include] };
    const result = await (
      globalThis as unknown as {
        axe: {
          run(
            target: unknown,
            options: unknown,
          ): Promise<{
            violations: Array<{
              id: string;
              impact: string | null;
              nodes: Array<{ target: unknown[] }>;
            }>;
          }>;
        };
      }
    ).axe.run(context, { resultTypes: ['violations'] });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    }));
  }, options.include);
  const { impacts } = options;
  return impacts === undefined
    ? violations
    : violations.filter((violation) =>
        impacts.includes(violation.impact ?? ''),
      );
};
