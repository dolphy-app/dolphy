import type { ScorerDescriptor } from './types.ts';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32 бита, hex из 8 символов: отпечаток параметров, не криптография. */
export const fnv1a32Hex = (text: string) => {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

interface ScorerDescriptorFields extends Omit<
  ScorerDescriptor,
  'parametersHash'
> {
  /** Всё, что меняет оценки: id модели, карта оценок, константы. */
  parameters: readonly string[];
}

export const createScorerDescriptor = ({
  parameters,
  ...fields
}: ScorerDescriptorFields): ScorerDescriptor => ({
  ...fields,
  parametersHash: fnv1a32Hex(parameters.join('|')),
});
