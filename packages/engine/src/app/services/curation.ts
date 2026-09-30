import type {
  CurationService,
  FilterStoreService,
  FlagService,
  SessionStoreService,
  UnitId,
} from '@dolphy-app/engine-contract';
import type { ParseResult } from '../../domain/manifest-schema.ts';
import {
  parseSavedFilter,
  parseStudySession,
} from '../../scheduler/filter-codec.ts';
import type { EngineContext } from '../context.ts';
import { EngineError } from '../errors.ts';
import { paginate } from '../pagination.ts';

type FlagName = 'blacklist' | 'review';
type SettingsScope = 'blacklist' | 'reviewList' | 'filters' | 'sessions';

const notFound = (details: Record<string, unknown>) =>
  new EngineError('NOT_FOUND', { details });

const parseOrThrow = <T>(kind: string, result: ParseResult<T>): T => {
  if (result.ok) return result.value;
  throw new EngineError('INVALID_ARGUMENT', {
    message: `Invalid ${kind}`,
    details: { issues: result.issues },
  });
};

/**
 * `curation.*` (engine-ts-api.md §5): флаги пишутся в журнал (`unit_flag`),
 * фильтры и учебные сессии — в хранилище настроек. Порядок в каждой команде:
 * запись, кэш, событие.
 */
export const createCurationService = (ctx: EngineContext): CurationService => {
  const emitChanged = (scope: SettingsScope) => {
    ctx.emit({ type: 'settings-changed', scope });
  };

  const isKnownUnit = (unitId: UnitId) =>
    ctx.library.require().graph.getUnitType(unitId) !== undefined;

  const createFlagService = (
    flag: FlagName,
    scope: 'blacklist' | 'reviewList',
  ): FlagService => {
    const has = (unitId: UnitId) => ctx.projections.flags.has(flag, unitId);

    const write = async (unitIds: readonly UnitId[], op: 'set' | 'unset') => {
      await ctx.commit(
        unitIds.map((unitId) => ({
          fields: { kind: 'unit_flag' as const, unitId, flag, op },
        })),
      );
      emitChanged(scope);
    };

    return {
      list: async (req) => paginate(ctx.projections.flags.list(flag), req),
      has: async (unitId) => has(unitId),
      add: async (unitId) => {
        if (!isKnownUnit(unitId)) throw notFound({ unitId });
        if (has(unitId)) return;
        await write([unitId], 'set');
      },
      remove: async (unitId) => {
        // юнит, пропавший из библиотеки, всё равно можно убрать из флага
        if (!has(unitId)) {
          if (!isKnownUnit(unitId)) throw notFound({ unitId });
          return;
        }
        await write([unitId], 'unset');
      },
      removePrefix: async (prefix) => {
        const removed = ctx.projections.flags
          .list(flag)
          .filter((unitId) => unitId.startsWith(prefix));
        if (removed.length > 0) await write(removed, 'unset');
        return { removed };
      },
    };
  };

  const filters: FilterStoreService = {
    list: async () =>
      (await ctx.settings.listFilters()).map(({ id, description }) => ({
        id,
        description,
      })),
    get: async (id) => {
      const found = (await ctx.settings.listFilters()).find(
        (filter) => filter.id === id,
      );
      if (found === undefined) throw notFound({ filterId: id });
      return structuredClone(found);
    },
    save: async (filter) => {
      const parsed = parseOrThrow('saved filter', parseSavedFilter(filter));
      await ctx.settings.saveFilter(parsed);
      ctx.savedFilters.set(parsed.id, parsed);
      emitChanged('filters');
    },
    delete: async (id) => {
      const existed = await ctx.settings.deleteFilter(id);
      if (!existed) throw notFound({ filterId: id });
      ctx.savedFilters.delete(id);
      emitChanged('filters');
    },
  };

  const sessions: SessionStoreService = {
    list: async () =>
      (await ctx.settings.listSessions()).map(({ id, description }) => ({
        id,
        description: description ?? '',
      })),
    get: async (id) => {
      const found = (await ctx.settings.listSessions()).find(
        (session) => session.id === id,
      );
      if (found === undefined) throw notFound({ sessionId: id });
      return structuredClone(found);
    },
    save: async (session) => {
      const parsed = parseOrThrow('study session', parseStudySession(session));
      await ctx.settings.saveSession(parsed);
      emitChanged('sessions');
    },
    delete: async (id) => {
      const existed = await ctx.settings.deleteSession(id);
      if (!existed) throw notFound({ sessionId: id });
      emitChanged('sessions');
    },
  };

  return {
    blacklist: createFlagService('blacklist', 'blacklist'),
    reviewList: createFlagService('review', 'reviewList'),
    filters,
    sessions,
  };
};
