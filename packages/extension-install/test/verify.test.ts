import type {
  CatalogEntry,
  CatalogVersion,
} from '@dolphy-app/extension-catalog';
import { describe, expect, it } from 'vitest';
import type { InspectedManifest } from '../src/options.ts';
import { manifestMismatch } from '../src/verify.ts';

const version = {
  version: '1.0.0',
} as unknown as CatalogVersion;

const entryWith = (
  contributes: Record<string, string[]>,
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
  version,
];

const manifestWith = (
  contributes: Partial<InspectedManifest['contributes']> = {},
): InspectedManifest => ({
  id: 'acme.state',
  version: '1.0.0',
  icon: null,
  tags: [],
  dependencies: [],
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
    schedules: [],
    importers: [],
    exporters: [],
    ...contributes,
  },
});

describe('manifestMismatch: settings и events', () => {
  it('совпадающие settings и events проходят', () => {
    const [entry, v] = entryWith({
      settings: ['acme.state.mode'],
      events: ['attempt.closed'],
    });
    const manifest = manifestWith({
      settings: ['acme.state.mode'],
      events: ['attempt.closed'],
    });
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

describe('manifestMismatch: schedules', () => {
  it('расписание в манифесте, которого нет в записи, и запись без расписания в манифесте отвергаются', () => {
    const [entry, v] = entryWith({});
    expect(
      manifestMismatch(
        manifestWith({ schedules: ['acme.state.daily'] }),
        entry,
        v,
      ),
    ).toContain('(schedules)');
    const [recorded, w] = entryWith({ schedules: ['acme.state.daily'] });
    expect(manifestMismatch(manifestWith(), recorded, w)).toContain(
      '(schedules)',
    );
  });

  it('одинаковые наборы без учёта порядка проходят', () => {
    const [entry, v] = entryWith({
      schedules: ['acme.state.a', 'acme.state.b'],
    });
    expect(
      manifestMismatch(
        manifestWith({ schedules: ['acme.state.b', 'acme.state.a'] }),
        entry,
        v,
      ),
    ).toBeNull();
  });
});

describe('manifestMismatch: importers и exporters', () => {
  it('импортёры и экспортёры манифеста и записи индекса должны совпадать', () => {
    const [bare, v] = entryWith({});
    expect(
      manifestMismatch(
        manifestWith({ importers: ['acme.state.csv'] }),
        bare,
        v,
      ),
    ).toContain('(importers)');
    expect(
      manifestMismatch(
        manifestWith({ exporters: ['acme.state.out'] }),
        bare,
        v,
      ),
    ).toContain('(exporters)');
    const [listed, w] = entryWith({ importers: ['acme.state.csv'] });
    expect(manifestMismatch(manifestWith(), listed, w)).toContain(
      '(importers)',
    );
    expect(
      manifestMismatch(
        manifestWith({ importers: ['acme.state.csv'] }),
        listed,
        w,
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

describe('manifestMismatch: dependencies', () => {
  const withDependencies = (
    dependencies?: { id: string; range?: string }[],
  ): CatalogVersion =>
    ({
      ...version,
      ...(dependencies === undefined ? {} : { dependencies }),
    }) as CatalogVersion;
  const [entry] = entryWith({});
  const manifest = (
    dependencies: { id: string; range: string | null }[],
  ): InspectedManifest => ({ ...manifestWith(), dependencies });
  const MESSAGE = 'manifest dependencies differ from the catalog entry';

  it('passes when equal in any order, with and without ranges, and when both are empty', () => {
    expect(
      manifestMismatch(
        manifest([
          { id: 'acme.b', range: null },
          { id: 'acme.a', range: '>=1.0.0' },
        ]),
        entry!,
        withDependencies([
          { id: 'acme.a', range: '>=1.0.0' },
          { id: 'acme.b' },
        ]),
      ),
    ).toBeNull();
    expect(
      manifestMismatch(manifest([]), entry!, withDependencies()),
    ).toBeNull();
  });

  it('rejects a missing, an extra and a different-range dependency', () => {
    expect(
      manifestMismatch(
        manifest([{ id: 'acme.a', range: null }]),
        entry!,
        withDependencies(),
      ),
    ).toBe(MESSAGE);
    expect(
      manifestMismatch(
        manifest([]),
        entry!,
        withDependencies([{ id: 'acme.a' }]),
      ),
    ).toBe(MESSAGE);
    expect(
      manifestMismatch(
        manifest([{ id: 'acme.a', range: '>=2.0.0' }]),
        entry!,
        withDependencies([{ id: 'acme.a', range: '>=1.0.0' }]),
      ),
    ).toBe(MESSAGE);
  });
});
