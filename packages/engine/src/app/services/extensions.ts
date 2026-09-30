import type {
  ContributionsDto,
  ExtensionInfoDto,
  ExtensionOriginDto,
  ExtensionsService,
} from '@lms/engine-contract';
import { GRADE_POLICIES } from '../../verify/grade-policy.ts';
import type { EngineContext } from '../context.ts';

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

/** `extensions.list` и `extensions.contributions`: снимки реестра, копии записей. */
export const createExtensionsService = (
  ctx: Pick<EngineContext, 'extensionRegistry'>,
): ExtensionsService => ({
  list: async () =>
    ctx.extensionRegistry.list().map(copyInfo).sort(compareInfo),
  contributions: async () =>
    sortedContributions(ctx.extensionRegistry.contributions()),
});
