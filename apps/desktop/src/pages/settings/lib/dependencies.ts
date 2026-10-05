import { isEffectiveExtensionState } from '@dolphy-app/engine-contract';
import type {
  ExtensionDependencyDto,
  ExtensionDiagnosticDto,
  ExtensionInfoDto,
} from '@dolphy-app/engine-contract';
import { satisfiesRange } from '@dolphy-app/extension-catalog/semver';

/**
 * Состояние зависимости. У установленного расширения: `ok` — загружена,
 * остальное — причина из диагностики. В каталоге: `installed` — есть и подходит
 * по версии, `missing` — не установлена, `version` — установлена другая версия.
 */
export type DependencyStatus =
  'ok' | 'installed' | 'missing' | 'disabled' | 'version' | 'unmet';

/** Строка списка зависимостей; `status: null` — состояние не показывается. */
export interface DependencyRow {
  id: string;
  range: string | null;
  status: DependencyStatus | null;
}

const CODE_STATUS: Partial<
  Record<ExtensionDiagnosticDto['code'], DependencyStatus>
> = {
  'dependency-missing': 'missing',
  'dependency-disabled': 'disabled',
  'dependency-version': 'version',
  'dependency-unmet': 'unmet',
};

const statusOfInstalled = (
  info: ExtensionInfoDto,
  id: string,
): DependencyStatus | null => {
  if (info.state === 'loaded') return 'ok';
  if (info.state !== 'dependencies-unmet') return null;
  const reason = info.diagnostics.find(
    (diagnostic) =>
      diagnostic.code in CODE_STATUS && diagnostic.data['id'] === id,
  );
  if (reason !== undefined) return CODE_STATUS[reason.code] ?? null;
  const cycle = info.diagnostics.find(
    ({ code }) => code === 'dependency-cycle',
  );
  const members = cycle?.data['cycle'];
  return Array.isArray(members) && members.includes(id) ? 'unmet' : 'ok';
};

/** Зависимости установленного расширения: загруженное — все `ok`, с невыполненными — по диагностикам, иначе без отметок. */
export const rowsOfInstalled = (info: ExtensionInfoDto): DependencyRow[] =>
  info.dependencies.map(({ id, range }) => ({
    id,
    range,
    status: statusOfInstalled(info, id),
  }));

/**
 * Зависимости версии каталога: установлено ли расширение (действующая запись,
 * включённое или нет) и подходит ли его версия. `installed === null` — список
 * установленных ещё не получен.
 */
export const rowsOfCatalog = (
  dependencies: readonly ExtensionDependencyDto[],
  installed: readonly ExtensionInfoDto[] | null,
): DependencyRow[] =>
  dependencies.map(({ id, range }) => {
    if (installed === null) return { id, range, status: null };
    const found = installed.find(
      (item) => item.id === id && isEffectiveExtensionState(item.state),
    );
    if (found === undefined) return { id, range, status: 'missing' };
    const fits =
      range === null ||
      found.version === null ||
      satisfiesRange(found.version, range);
    return { id, range, status: fits ? 'installed' : 'version' };
  });

/** Данные диагностики для сообщения: диапазон с пробелом впереди (или пусто) и цикл списком через запятую. */
export const dependencyMessageParams = (
  diagnostic: ExtensionDiagnosticDto,
): Record<string, string | number | string[]> => {
  const { range, cycle } = diagnostic.data;
  return {
    ...diagnostic.data,
    range: typeof range === 'string' ? ` ${range}` : '',
    cycle: Array.isArray(cycle) ? cycle.join(', ') : '',
  };
};
