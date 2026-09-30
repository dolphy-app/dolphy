import type {
  ExerciseTypeInfo,
  ExerciseTypes,
  GradePolicyInfo,
} from '@lms/engine/ports';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js';
import type { ResolvedExtension } from './discover.ts';

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

export const createCatalog = (
  extensions: readonly ResolvedExtension[],
): Catalog => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const entries = new Map<string, Entry>();
  for (const owner of extensions) {
    for (const type of owner.exerciseTypes) {
      entries.set(type.id, {
        owner,
        info: {
          type: type.id,
          extensionId: owner.id,
          extensionVersion: owner.version,
          element: type.element,
          rendererUrl: type.rendererUrl,
        },
        validateSpec: ajv.compile(type.specSchema),
        validateAnswer: ajv.compile(type.answerSchema),
      });
    }
  }
  const policyOwners = new Map<string, ResolvedExtension>();
  const policyInfos: GradePolicyInfo[] = [];
  for (const owner of extensions) {
    for (const { id, label } of owner.gradePolicies) {
      policyOwners.set(id, owner);
      policyInfos.push({ id, label, extensionId: owner.id });
    }
  }
  const infos = [...entries.values()].map((entry) => entry.info);
  const validate = (
    type: string,
    pick: (entry: Entry) => ValidateFunction,
    value: unknown,
  ): readonly string[] => {
    const entry = entries.get(type);
    if (entry === undefined) return ['unknown exercise type'];
    const check = pick(entry);
    return check(value) ? [] : messages(check.errors);
  };
  return {
    describe: (type) => entries.get(type)?.info,
    list: () => infos,
    validateSpec: (type, spec) => validate(type, (e) => e.validateSpec, spec),
    validateAnswer: (type, answer) =>
      validate(type, (e) => e.validateAnswer, answer),
    ownerOf: (type) => entries.get(type)?.owner,
    ownerOfPolicy: (id) => policyOwners.get(id),
    describePolicies: () => policyInfos,
  };
};
