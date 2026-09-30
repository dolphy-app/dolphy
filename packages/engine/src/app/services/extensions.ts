import type {
  ExtensionInfoDto,
  ExtensionOriginDto,
  ExtensionsService,
} from '@lms/engine-contract';
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

const copyInfo = (info: ExtensionInfoDto): ExtensionInfoDto => ({
  ...info,
  exerciseTypes: [...info.exerciseTypes],
});

/** `extensions.list`: снимок реестра в стабильном порядке, копии записей. */
export const createExtensionsService = (
  ctx: Pick<EngineContext, 'extensionRegistry'>,
): ExtensionsService => ({
  list: async () =>
    ctx.extensionRegistry.list().map(copyInfo).sort(compareInfo),
});
