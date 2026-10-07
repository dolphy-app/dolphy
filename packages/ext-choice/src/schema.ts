import type { JsonSchema } from '@dolphy-app/extension-sdk';

export const specSchema: JsonSchema = {
  type: 'object',
  required: ['options', 'correct'],
  additionalProperties: false,
  properties: {
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 12,
      items: { type: 'string', minLength: 1, maxLength: 500 },
    },
    correct: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'integer', minimum: 0 },
    },
    multiple: { type: 'boolean' },
  },
};

export const answerSchema: JsonSchema = {
  type: 'array',
  maxItems: 12,
  uniqueItems: true,
  items: { type: 'integer', minimum: 0 },
};
