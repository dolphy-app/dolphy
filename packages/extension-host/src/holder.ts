import { isDeepStrictEqual } from 'node:util';
import type { ExtensionDiagnosticDto } from '@dolphy-app/engine-contract';
import { EMPTY_SERVER_REGISTRATION } from '@dolphy-app/extension-api';
import type { ServerRegistration } from '@dolphy-app/extension-api';
import { exerciseTypeIssue } from './catalog.ts';
import type {
  DiscoveryDiagnostic,
  DiscoveryResult,
  ExtensionCandidate,
  OverriddenExtension,
  ResolvedExtension,
} from './discover.ts';
import type {
  ExtensionRegistrationResult,
  ReplaceExtensionsResult,
} from './protocol.ts';

/**
 * Снимок набора расширений: найденное на диске и то, что зарегистрировал код.
 * `extensions` — расширения, которые действуют (код зарегистрировался, имена
 * не заняты другими); остальное — `diagnostics` (`load-failed`, `claim-clash`
 * и сбои обнаружения). `candidates` — всё найденное, без регистраций.
 */
export interface DiscoverySnapshot {
  extensions: ResolvedExtension[];
  candidates: ExtensionCandidate[];
  diagnostics: DiscoveryDiagnostic[];
  overridden: OverriddenExtension[];
}

/**
 * Изменяемый снимок обнаружения. Политика, каталог видов, реестр и установщик
 * читают его через `get()` при каждом вызове, а не держат значение: применение
 * изменений расширений заменяет снимок целиком (`replace`,
 * `applyRegistrations`), и все они видят новое состояние сразу. Подмена
 * атомарна: читатель получает либо прежний, либо новый снимок целиком.
 */
export interface DiscoveryHolder {
  get(): DiscoverySnapshot;
  /**
   * Новый набор кандидатов. Расширение, у которого код тот же (`version`,
   * `revision`, `dir`, `mainPath`), сохраняет регистрацию: хост его не
   * перезапускает и вернёт ту же. У остальных регистрации пусты, пока не
   * пришли новые.
   */
  replace(next: DiscoveryResult): void;
  /**
   * Собирает `ResolvedExtension` из кандидата и его регистрации, отвергает
   * расширения с `ok: false` (`load-failed`), с несжимаемой схемой вида
   * задания или с именем, занятым более ранним расширением (`claim-clash`).
   * Кандидат, которого в ответе нет, остаётся с пустой регистрацией. Возвращает
   * `true`, если снимок изменился (иначе прежний объект остаётся в силе).
   */
  applyRegistrations(result: ReplaceExtensionsResult): boolean;
}

/** Только чтение: то, что нужно политике, каталогу и реестру. */
export type DiscoverySource = Pick<DiscoveryHolder, 'get'>;

const claimsOf = (registration: ServerRegistration): string[] => [
  ...registration.exerciseTypes.map(({ id }) => `exerciseType:${id}`),
  ...registration.gradePolicies.map(({ id }) => `gradePolicy:${id}`),
  ...registration.settings.map(({ id }) => `setting:${id}`),
  ...registration.commands.map(({ id }) => `command:${id}`),
  ...registration.schedules.map(({ id }) => `schedule:${id}`),
  ...registration.importers.map(({ id }) => `importer:${id}`),
  ...registration.exporters.map(({ id }) => `exporter:${id}`),
];

const clashDiagnostic = (claim: string, by: string): ExtensionDiagnosticDto => {
  const separator = claim.indexOf(':');
  return {
    code: 'claim-clash',
    data: {
      kind: claim.slice(0, separator),
      name: claim.slice(separator + 1),
      by,
    },
  };
};

const loadFailed = (reason: string): ExtensionDiagnosticDto => ({
  code: 'load-failed',
  data: { reason },
});

/** Регистрация кандидата в ответе хоста; без записи — пустая. */
const registrationOf = (
  candidate: ExtensionCandidate,
  results: Readonly<Record<string, ExtensionRegistrationResult>>,
): ExtensionRegistrationResult =>
  results[candidate.id] ?? {
    ok: true,
    registration: EMPTY_SERVER_REGISTRATION,
  };

const assemble = (
  discovered: DiscoveryResult,
  results: Readonly<Record<string, ExtensionRegistrationResult>>,
): DiscoverySnapshot => {
  const diagnostics = [...discovered.diagnostics];
  const extensions: ResolvedExtension[] = [];
  const claimed = new Map<string, string>();
  const reject = (
    { id, origin }: ExtensionCandidate,
    diagnostic: ExtensionDiagnosticDto,
  ): void => {
    diagnostics.push({ extensionId: id, origin, diagnostic });
  };
  for (const candidate of discovered.extensions) {
    const result = registrationOf(candidate, results);
    if (!result.ok) {
      reject(candidate, loadFailed(result.error));
      continue;
    }
    const { registration } = result;
    const schemaIssue = exerciseTypeIssue(registration.exerciseTypes);
    if (schemaIssue !== null) {
      reject(candidate, loadFailed(schemaIssue));
      continue;
    }
    const claims = claimsOf(registration);
    const clash = claims.find((claim) => claimed.has(claim));
    if (clash !== undefined) {
      reject(candidate, clashDiagnostic(clash, claimed.get(clash) ?? ''));
      continue;
    }
    for (const claim of claims) claimed.set(claim, candidate.id);
    extensions.push({ ...candidate, ...registration });
  }
  return {
    extensions,
    candidates: [...discovered.extensions],
    diagnostics,
    overridden: [...discovered.overridden],
  };
};

/** Одинаковый код расширения: хост расширений не перезапускает его и оставляет прежнюю регистрацию. */
const sameCode = (a: ExtensionCandidate, b: ExtensionCandidate): boolean =>
  a.id === b.id &&
  a.version === b.version &&
  a.revision === b.revision &&
  a.dir === b.dir &&
  a.mainPath === b.mainPath;

export const createDiscoveryHolder = (
  initial: DiscoveryResult,
): DiscoveryHolder => {
  let discovered = initial;
  let results: Record<string, ExtensionRegistrationResult> = {};
  let current = assemble(initial, results);
  return {
    get: () => current,
    replace(next) {
      const kept: Record<string, ExtensionRegistrationResult> = {};
      for (const candidate of next.extensions) {
        const before = discovered.extensions.find(
          ({ id }) => id === candidate.id,
        );
        const result = results[candidate.id];
        if (
          before !== undefined &&
          result?.ok === true &&
          sameCode(before, candidate)
        ) {
          kept[candidate.id] = result;
        }
      }
      discovered = next;
      results = kept;
      current = assemble(next, results);
    },
    applyRegistrations({ registrations }) {
      const next = assemble(discovered, registrations);
      if (isDeepStrictEqual(next, current)) return false;
      results = registrations;
      current = next;
      return true;
    },
  };
};

/** Набор, полученный готовым (хост расширений, тесты): без диагностик и перекрытых расширений. */
export const discoveryOf = (
  candidates: readonly ExtensionCandidate[],
): DiscoveryResult => ({
  extensions: [...candidates],
  diagnostics: [],
  overridden: [],
});
