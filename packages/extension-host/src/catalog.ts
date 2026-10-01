import type {
  ExerciseTypeInfo,
  ExtensionPolicy,
  ExerciseTypes,
  GradePolicyInfo,
} from '@dolphy-app/engine/ports';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js';
import type { ResolvedExtension } from './discover.ts';
import type { DiscoverySource } from './holder.ts';

const MAX_ISSUES = 6;

export type Catalog = Pick<
  ExerciseTypes,
  'describe' | 'list' | 'validateSpec' | 'validateAnswer'
> & {
  ownerOf(type: string): ResolvedExtension | undefined;
  ownerOfPolicy(id: string): ResolvedExtension | undefined;
  describePolicies(): readonly GradePolicyInfo[];
};

interface Entry {
  info: ExerciseTypeInfo;
  owner: ResolvedExtension;
  validateSpec: ValidateFunction;
  validateAnswer: ValidateFunction;
}

const messages = (errors: ErrorObject[] | null | undefined): string[] =>
  (errors ?? [])
    .slice(0, MAX_ISSUES)
    .map((error) => `${error.instancePath || '/'} ${error.message}`);

interface View {
  /** Массив снимка, из которого построен вид: пока он тот же, вид годится. */
  source: readonly ResolvedExtension[];
  entries: Map<string, Entry>;
  policyOwners: Map<string, ResolvedExtension>;
  policyInfos: GradePolicyInfo[];
}

const buildView = (source: readonly ResolvedExtension[]): View => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const entries = new Map<string, Entry>();
  const policyOwners = new Map<string, ResolvedExtension>();
  const policyInfos: GradePolicyInfo[] = [];
  for (const owner of source) {
    for (const type of owner.exerciseTypes) {
      entries.set(type.id, {
        owner,
        info: {
          type: type.id,
          extensionId: owner.id,
          extensionVersion: owner.version,
          extensionOrigin: owner.origin,
          extensionRevision: owner.revision,
          element: type.element,
          rendererUrl: type.rendererUrl,
        },
        validateSpec: ajv.compile(type.specSchema),
        validateAnswer: ajv.compile(type.answerSchema),
      });
    }
    for (const { id, label } of owner.gradePolicies) {
      policyOwners.set(id, owner);
      policyInfos.push({ id, label, extensionId: owner.id });
    }
  }
  return { source, entries, policyOwners, policyInfos };
};

/**
 * Отключённые пользователем расширения ведут себя так, будто их нет. Вид
 * строится из снимка обнаружения и пересобирается, когда снимок заменён:
 * схемы компилируются один раз на снимок, а не на вызов.
 */
export const createCatalog = (
  discovery: DiscoverySource,
  policy: ExtensionPolicy,
): Catalog => {
  let built: View | null = null;
  const view = (): View => {
    const { extensions } = discovery.get();
    if (built === null || built.source !== extensions) {
      built = buildView(extensions);
    }
    return built;
  };
  const active = (type: string): Entry | undefined => {
    const entry = view().entries.get(type);
    return entry !== undefined && policy.isEnabled(entry.owner.id)
      ? entry
      : undefined;
  };
  const activePolicyOwner = (id: string): ResolvedExtension | undefined => {
    const owner = view().policyOwners.get(id);
    return owner !== undefined && policy.isEnabled(owner.id)
      ? owner
      : undefined;
  };
  const validate = (
    type: string,
    pick: (entry: Entry) => ValidateFunction,
    value: unknown,
  ): readonly string[] => {
    const entry = active(type);
    if (entry === undefined) return ['unknown exercise type'];
    const check = pick(entry);
    return check(value) ? [] : messages(check.errors);
  };
  return {
    describe: (type) => active(type)?.info,
    list: () =>
      [...view().entries.values()]
        .filter(({ owner }) => policy.isEnabled(owner.id))
        .map(({ info }) => info),
    validateSpec: (type, spec) => validate(type, (e) => e.validateSpec, spec),
    validateAnswer: (type, answer) =>
      validate(type, (e) => e.validateAnswer, answer),
    ownerOf: (type) => active(type)?.owner,
    ownerOfPolicy: activePolicyOwner,
    describePolicies: () =>
      view().policyInfos.filter(({ extensionId }) =>
        policy.isEnabled(extensionId),
      ),
  };
};
