import type { Diagnostic } from '@spirula-app/engine-contract';
import { diag, summarize } from '../authoring/diagnostics.ts';
import type { LibraryStatus } from '../authoring/library-holder.ts';
import type { Clock, CourseSource } from '../ports/index.ts';

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Проверка корня библиотеки перед сканированием: нет каталога или он
 * недоступен — `E_IO` данными, а не исключение (engine-ts.md §9: движок
 * остаётся в состоянии `library-invalid`, журнал и настройки доступны).
 * Компилятор такой корень не различает и падает на первом `list`.
 */
export const checkLibraryRoot = async (
  source: CourseSource,
): Promise<Diagnostic | null> => {
  try {
    const stat = await source.stat('');
    if (stat?.kind === 'directory') return null;
    return diag('E_IO', `library root is not a directory: ${source.root}`, {
      path: '',
    });
  } catch (error) {
    return diag('E_IO', `library root is unreadable: ${messageOf(error)}`, {
      path: '',
    });
  }
};

/** Состояние `invalid` с одной диагностикой (нет библиотеки, нет графа). */
export const invalidStatus = (
  diagnostic: Diagnostic,
  clock: Clock,
): LibraryStatus => ({
  state: 'invalid',
  library: null,
  diagnostics: [diagnostic],
  summary: summarize([diagnostic]),
  revision: '',
  artifact: 'missing',
  loadedAt: clock.now(),
  loadMs: 0,
});
