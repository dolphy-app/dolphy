import type {
  ContributionsDto,
  ExtensionInfoDto,
  ExtensionOriginDto,
  ExtensionSettingsDto,
  ExtensionsService,
} from '@lms/engine-contract';
import {
  isExtensionId,
  normalizeExtensionSettings,
} from '../../domain/extension-settings.ts';
import { GRADE_POLICIES } from '../../verify/grade-policy.ts';
import type { EngineContext } from '../context.ts';
import { EngineError } from '../errors.ts';

const ORIGIN_RANK: Readonly<Record<ExtensionOriginDto, number>> = {
  bundled: 0,
  user: 1,
  dev: 2,
};

const compareInfo = (a: ExtensionInfoDto, b: ExtensionInfoDto): number => {
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin];
};

const compareBy =
  <T>(key: (item: T) => string) =>
  (a: T, b: T): number => {
    const [left, right] = [key(a), key(b)];
    if (left === right) return 0;
    return left < right ? -1 : 1;
  };

const copyInfo = (info: ExtensionInfoDto): ExtensionInfoDto => ({
  ...info,
  contributes: {
    exerciseTypes: [...info.contributes.exerciseTypes],
    themes: [...info.contributes.themes],
    markdownRenderers: [...info.contributes.markdownRenderers],
    gradePolicies: [...info.contributes.gradePolicies],
  },
  permissions: [...info.permissions],
});

const BUILTIN_POLICIES = Object.keys(GRADE_POLICIES).map((id) => ({
  id,
  extensionId: null,
  label: null,
}));

const sortedContributions = (source: ContributionsDto): ContributionsDto => {
  const copy = structuredClone(source);
  return {
    themes: copy.themes.sort(compareBy((theme) => theme.id)),
    markdownRenderers: copy.markdownRenderers.sort(
      compareBy((renderer) => renderer.language),
    ),
    gradePolicies: [
      ...BUILTIN_POLICIES,
      ...copy.gradePolicies.sort(compareBy((policy) => policy.id)),
    ],
  };
};

/** Расширение, чьи настройки можно менять: действующее (`loaded`/`disabled`) и не из поставки. */
const findToggleable = (
  items: readonly ExtensionInfoDto[],
  id: string,
): ExtensionInfoDto => {
  const known = items.filter((item) => item.id === id);
  if (known.length === 0) {
    throw new EngineError('NOT_FOUND', {
      message: `Extension not found: ${id}`,
      details: { extensionId: id },
    });
  }
  const effective = known.find(
    ({ state }) => state === 'loaded' || state === 'disabled',
  );
  if (effective === undefined || effective.origin === 'bundled') {
    throw new EngineError('INVALID_ARGUMENT', {
      message: `Extension '${id}' cannot be configured`,
      details: {
        reason: effective === undefined ? 'not-loaded' : 'bundled',
        extensionId: id,
      },
    });
  }
  return effective;
};

const withMember = (
  ids: readonly string[],
  id: string,
  member: boolean,
): string[] => {
  const rest = ids.filter((item) => item !== id);
  return member ? [...rest, id] : rest;
};

/** `extensions.*`: снимки реестра, копии записей и настройки включения и доверия. */
export const createExtensionsService = (
  ctx: Pick<
    EngineContext,
    'extensionRegistry' | 'extensionPolicy' | 'settings' | 'emit'
  >,
): ExtensionsService => {
  const change = async (
    id: string,
    apply: (settings: ExtensionSettingsDto) => ExtensionSettingsDto,
  ): Promise<ExtensionSettingsDto> => {
    if (!isExtensionId(id)) {
      throw new EngineError('INVALID_ARGUMENT', {
        message: `Invalid extension id: ${String(id)}`,
        details: { field: 'id' },
      });
    }
    findToggleable(ctx.extensionRegistry.list(), id);
    const before = await ctx.settings.loadExtensions();
    const next = normalizeExtensionSettings(apply(before));
    if (JSON.stringify(next) === JSON.stringify(before)) return next;
    // сначала хранилище: отказ записи не должен менять живую политику
    await ctx.settings.saveExtensions(next);
    ctx.extensionPolicy.update(next);
    ctx.emit({ type: 'settings-changed', scope: 'extensions' });
    return next;
  };
  return {
    list: async () =>
      ctx.extensionRegistry.list().map(copyInfo).sort(compareInfo),
    contributions: async () =>
      sortedContributions(ctx.extensionRegistry.contributions()),
    getSettings: async () =>
      normalizeExtensionSettings(await ctx.settings.loadExtensions()),
    setEnabled: (id, enabled) =>
      change(id, (settings) => ({
        ...settings,
        disabled: withMember(settings.disabled, id, !enabled),
      })),
    setTrusted: (id, trusted) =>
      change(id, (settings) => ({
        ...settings,
        trusted: withMember(settings.trusted, id, trusted),
      })),
  };
};
