import { describe, expect, it } from 'vitest';
import type { DiscoveryResult, ResolvedExtension } from '../src/discover.ts';
import { createExtensionRegistry } from '../src/registry.ts';

const extension = (id: string, version = '1.0.0'): ResolvedExtension => ({
  id,
  version,
  origin: 'user',
  dir: `/x/${id}`,
  mainPath: `/x/${id}/main.mjs`,
  exerciseTypes: [
    {
      id: `${id}.a`,
      specSchema: {},
      answerSchema: {},
      element: 'x-a',
      rendererUrl: 'lms-ext://x/view.mjs',
    },
  ],
});

const discovery: DiscoveryResult = {
  extensions: [extension('lms.sql', '1.0.1')],
  overridden: [
    {
      id: 'lms.sql',
      version: '1.0.0',
      origin: 'bundled',
      by: { origin: 'user', version: '1.0.1' },
    },
  ],
  diagnostics: [
    { extensionId: 'broken-dir', origin: 'user', message: 'bad manifest' },
  ],
};

describe('createExtensionRegistry', () => {
  const items = createExtensionRegistry(discovery).list();

  it('maps loaded extensions with their exercise types', () => {
    expect(items).toContainEqual({
      id: 'lms.sql',
      version: '1.0.1',
      origin: 'user',
      state: 'loaded',
      exerciseTypes: ['lms.sql.a'],
      message: null,
    });
  });

  it('maps overridden copies with the overriding origin and version', () => {
    expect(items).toContainEqual({
      id: 'lms.sql',
      version: '1.0.0',
      origin: 'bundled',
      state: 'overridden',
      exerciseTypes: [],
      message: 'overridden by user 1.0.1',
    });
  });

  it('maps diagnostics to invalid entries without a version', () => {
    expect(items).toContainEqual({
      id: 'broken-dir',
      version: null,
      origin: 'user',
      state: 'invalid',
      exerciseTypes: [],
      message: 'bad manifest',
    });
  });

  it('returns copies', () => {
    const registry = createExtensionRegistry(discovery);
    registry.list()[0]?.exerciseTypes.push('evil');
    expect(registry.list()[0]?.exerciseTypes).toEqual(['lms.sql.a']);
  });
});
