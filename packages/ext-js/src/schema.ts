import type { JsonSchema } from '@dolphy-app/extension-api';

export const specSchema: JsonSchema = {
  type: 'object',
  required: ['tests'],
  additionalProperties: false,
  properties: {
    tests: { type: 'string', minLength: 1 },
    reference: { type: 'string', minLength: 1 },
    starter: { type: 'string' },
    maxOutputChars: { type: 'integer', minimum: 1, maximum: 1000000 },
  },
};

export const answerSchema: JsonSchema = { type: 'string', maxLength: 20000 };
