import type {
  CatalogEntry,
  CatalogVersion,
} from '@dolphy-app/extension-catalog';
import { describe, expect, it } from 'vitest';
import type { InspectedManifest } from '../src/options.ts';
import { manifestMismatch } from '../src/verify.ts';

const version = {
  version: '1.0.0',
  permissions: [],
} as unknown as CatalogVersion;

const entryWith = (
  contributes: Record<string, string[]>,
  permissions: string[] = [],
): [CatalogEntry, CatalogVersion] => [
  {
    id: 'acme.state',
    contributes: {
      exerciseTypes: [],
      themes: [],
      markdownRenderers: [],
      gradePolicies: [],
      ...contributes,
    },
  } as unknown as CatalogEntry,
  { ...version, permissions } as CatalogVersion,
];

const manifestWith = (
  contributes: Partial<InspectedManifest['contributes']> = {},
  permissions: string[] = [],
): InspectedManifest => ({
  id: 'acme.state',
  version: '1.0.0',
  permissions,
  icon: null,
  tags: [],
  contributes: {
    exerciseTypes: [],
    themes: [],
    markdownRenderers: [],
    gradePolicies: [],
    settings: [],
    events: [],
    commands: [],
    panels: [],
    widgets: [],
    ...contributes,
  },
});

describe('manifestMismatch: settings, events и разрешение', () => {
  it('совпадающие settings и events проходят', () => {
    const [entry, v] = entryWith(
      { settings: ['acme.state.mode'], events: ['attempt.closed'] },
      ['learning.events'],
    );
    const manifest = manifestWith(
      { settings: ['acme.state.mode'], events: ['attempt.closed'] },
      ['learning.events'],
    );
    expect(manifestMismatch(manifest, entry, v)).toBeNull();
  });

  it('запись без ключей и манифест без settings/events проходят', () => {
    const [entry, v] = entryWith({});
    expect(manifestMismatch(manifestWith(), entry, v)).toBeNull();
  });

  it('расхождение id настроек отвергается', () => {
    const [entry, v] = entryWith({ settings: ['acme.state.mode'] });
    const manifest = manifestWith({ settings: ['acme.state.other'] });
    expect(manifestMismatch(manifest, entry, v)).toContain('(settings)');
  });

  it('события в манифесте, которых нет в записи, отвергаются', () => {
    const [entry, v] = entryWith({});
    const manifest = manifestWith({ events: ['session.started'] });
    expect(manifestMismatch(manifest, entry, v)).toContain('(events)');
  });

  it('записанные в индексе, но не объявленные события отвергаются', () => {
    const [entry, v] = entryWith({ events: ['session.started'] });
    expect(manifestMismatch(manifestWith(), entry, v)).toContain('(events)');
  });

  it('разрешение learning.events должно совпасть', () => {
    const [entry, v] = entryWith({});
    const manifest = manifestWith({}, ['learning.events']);
    expect(manifestMismatch(manifest, entry, v)).toContain('permissions');
  });
});

describe('manifestMismatch: commands и panels', () => {
  it('команды и панели в манифесте, которых нет в записи, отвергаются', () => {
    const [entry, v] = entryWith({});
    expect(
      manifestMismatch(manifestWith({ commands: ['acme.state.go'] }), entry, v),
    ).toContain('(commands)');
    expect(
      manifestMismatch(manifestWith({ panels: ['acme.state.main'] }), entry, v),
    ).toContain('(panels)');
  });

  it('записанные в индексе, но не объявленные команды и панели отвергаются', () => {
    const [commands, v] = entryWith({ commands: ['acme.state.go'] });
    expect(manifestMismatch(manifestWith(), commands, v)).toContain(
      '(commands)',
    );
    const [panels, w] = entryWith({ panels: ['acme.state.main'] });
    expect(manifestMismatch(manifestWith(), panels, w)).toContain('(panels)');
  });

  it('одинаковые наборы без учёта порядка проходят', () => {
    const [entry, v] = entryWith({
      commands: ['acme.state.a', 'acme.state.b'],
      panels: ['acme.state.p', 'acme.state.q'],
    });
    const manifest = manifestWith({
      commands: ['acme.state.b', 'acme.state.a'],
      panels: ['acme.state.q', 'acme.state.p'],
    });
    expect(manifestMismatch(manifest, entry, v)).toBeNull();
  });
});

describe('manifestMismatch: widgets', () => {
  it('виджет в манифесте, которого нет в записи, и запись без виджета в манифесте отвергаются', () => {
    const [entry, v] = entryWith({});
    expect(
      manifestMismatch(
        manifestWith({ widgets: ['acme.state.card'] }),
        entry,
        v,
      ),
    ).toContain('(widgets)');
    const [recorded, w] = entryWith({ widgets: ['acme.state.card'] });
    expect(manifestMismatch(manifestWith(), recorded, w)).toContain(
      '(widgets)',
    );
  });

  it('одинаковые наборы без учёта порядка проходят', () => {
    const [entry, v] = entryWith({
      widgets: ['acme.state.a', 'acme.state.b'],
    });
    expect(
      manifestMismatch(
        manifestWith({ widgets: ['acme.state.b', 'acme.state.a'] }),
        entry,
        v,
      ),
    ).toBeNull();
  });
});

describe('manifestMismatch: tags', () => {
  const taggedVersion = (tags?: string[]): CatalogVersion =>
    ({ ...version, ...(tags === undefined ? {} : { tags }) }) as CatalogVersion;
  const [entry] = entryWith({});
  const manifest = (tags: string[]): InspectedManifest => ({
    ...manifestWith(),
    tags,
  });

  it('passes when the sets are equal in any order, and when both are empty', () => {
    expect(
      manifestMismatch(
        manifest(['theme', 'interface']),
        entry!,
        taggedVersion(['interface', 'theme']),
      ),
    ).toBeNull();
    expect(manifestMismatch(manifest([]), entry!, taggedVersion())).toBeNull();
  });

  it('rejects tags the record lacks and tags the manifest lacks', () => {
    expect(manifestMismatch(manifest(['theme']), entry!, taggedVersion())).toBe(
      'manifest tags differ from the catalog entry',
    );
    expect(
      manifestMismatch(manifest([]), entry!, taggedVersion(['theme'])),
    ).toBe('manifest tags differ from the catalog entry');
    expect(
      manifestMismatch(
        manifest(['theme']),
        entry!,
        taggedVersion(['theme', 'interface']),
      ),
    ).toBe('manifest tags differ from the catalog entry');
  });
});
