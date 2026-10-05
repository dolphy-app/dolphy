import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { Page } from 'playwright-core';

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
 */
export const runAxe = async (
  page: Page,
  options: { include?: string } = {},
): Promise<AxeViolation[]> => {
  await page.evaluate(await axeSource());
  return page.evaluate(async (include) => {
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
};
