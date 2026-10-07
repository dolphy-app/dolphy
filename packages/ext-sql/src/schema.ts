import type { JsonSchema } from '@dolphy-app/extension-api';

export const specSchema: JsonSchema = {
  type: 'object',
  required: ['fixture', 'expected'],
  additionalProperties: false,
  properties: {
    fixture: { type: 'string', minLength: 1 },
    expected: { type: 'string', minLength: 1 },
    reference: { type: 'string', minLength: 1 },
    orderSensitive: { type: 'boolean' },
    ignoreColumnNames: { type: 'boolean' },
    numericTolerance: { type: 'number', minimum: 0 },
    columnOrder: { enum: ['strict', 'any'] },
    maxRows: { type: 'integer', minimum: 1, maximum: 100000 },
    maxBytes: { type: 'integer', minimum: 1, maximum: 10000000 },
  },
};

export const answerSchema: JsonSchema = { type: 'string' };
