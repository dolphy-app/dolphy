import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ExtensionSettingsDto } from '@dolphy-app/engine-contract';
import type { ExtensionDependency } from '@dolphy-app/extension-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  dependencyCycles,
  dependencyIssues,
  orderByDependencies,
} from '../src/dependencies.ts';
import type { DependencyNode } from '../src/dependencies.ts';
import { formatDiagnostic } from '../src/diagnostics.ts';
import { discoverExtensions } from '../src/discover.ts';
import type { ExtensionOrigin, ResolvedExtension } from '../src/discover.ts';
import { createDiscoveryHolder, discoveryOf } from '../src/holder.ts';
import { parseManifest } from '../src/manifest.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import { createExtensionRegistry } from '../src/registry.ts';
import { createLogger } from './helpers.ts';

const dep = (id: string, range: string | null = null): ExtensionDependency => ({
  id,
  range,
});

const node = (
  id: string,
  dependencies: ExtensionDependency[] = [],
  version = '1.0.0',
): DependencyNode => ({ id, version, dependencies });

const extension = (
  id: string,
  dependencies: ExtensionDependency[] = [],
  patch: Partial<ResolvedExtension> = {},
): ResolvedExtension => ({
  id,
  version: '1.0.0',
  origin: 'user' satisfies ExtensionOrigin,
  revision: '',
  dir: `/x/${id}`,
  mainPath: null,
  name: null,
  description: null,
  author: null,
  dependencies,
  platforms: [],
  minAppVersion: null,
  icon: null,
  tags: [],
  install: null,
  messages: {},
  warnings: [],
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
  settings: [],
  events: [],
  commands: [
    { id: `${id}.run`, title: id, description: null, category: null },
  ] as never,
  widgets: [],
  schedules: [],
  panels: [],
  importers: [],
  exporters: [],
  ...patch,
});

const SETTINGS: ExtensionSettingsDto = {
  disabled: [],
  checkUpdates: true,
  safeMode: false,
  notificationsOff: [],
  catalogUrl: null,
  schedulesOff: [],
};

const open = (...items: ResolvedExtension[]) => {
  const holder = createDiscoveryHolder(discoveryOf(items));
  const policy = createExtensionPolicy(holder);
  const registry = createExtensionRegistry(holder, policy);
  const disable = (...ids: string[]) =>
    policy.update({ ...SETTINGS, disabled: ids });
  const stateOf = (id: string) =>
    registry.list().find((item) => item.id === id)?.state;
  const codesOf = (id: string) =>
    registry
      .list()
      .find((item) => item.id === id)
      ?.diagnostics.map(({ code }) => code);
  return { holder, policy, registry, disable, stateOf, codesOf };
};

describe('manifest: dependencies', () => {
  const manifest = (dependencies: unknown) => ({
    id: 'acme.quiz',
    version: '1.0.0',
    apiVersion: 1,
    main: './main.mjs',
    dependencies,
    contributes: { gradePolicies: [{ id: 'acme.quiz', label: 'Quiz' }] },
  });

  it('accepts ids with and without a range and fills range with null', () => {
    const result = parseManifest(
      manifest([
        { id: 'acme.base' },
        { id: 'acme.other', range: '>=1.2.0 <2.0.0' },
      ]),
    );
    expect(result.ok && result.manifest.dependencies).toEqual([
      { id: 'acme.base', range: null },
      { id: 'acme.other', range: '>=1.2.0 <2.0.0' },
    ]);
  });

  it('defaults to no dependencies', () => {
    const withoutKey: Record<string, unknown> = manifest([]);
    delete withoutKey['dependencies'];
    const result = parseManifest(withoutKey);
    expect(result.ok && result.manifest.dependencies).toEqual([]);
  });

  it('accepts 16 dependencies and rejects 17', () => {
    const list = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: `acme.dep${i}` }));
    expect(parseManifest(manifest(list(16))).ok).toBe(true);
    const tooMany = parseManifest(manifest(list(17)));
    expect(tooMany.ok).toBe(false);
  });

  it.each([
    ['itself', [{ id: 'acme.quiz' }], 'cannot depend on itself'],
    [
      'a repeat',
      [{ id: 'acme.a' }, { id: 'acme.a' }],
      "duplicate dependency 'acme.a'",
    ],
    [
      'an unreadable range',
      [{ id: 'acme.a', range: 'newer' }],
      'range must be',
    ],
    ['an empty range', [{ id: 'acme.a', range: '' }], 'range must be'],
    ['a bad id', [{ id: 'Not An Id' }], 'invalid extension id'],
    ['an unknown key', [{ id: 'acme.a', optional: true }], 'optional'],
    ['a non-array', { id: 'acme.a' }, 'dependencies'],
  ])('rejects %s', (_name, dependencies, message) => {
    const result = parseManifest(manifest(dependencies));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(formatDiagnostic(result.diagnostic)).toContain(message);
    }
  });
});

describe('dependencyCycles', () => {
  it('finds members of a cycle and leaves the rest', () => {
    const cycles = dependencyCycles([
      node('a', [dep('b')]),
      node('b', [dep('c')]),
      node('c', [dep('a')]),
      node('d', [dep('a')]),
      node('e', [dep('missing')]),
    ]);
    expect([...cycles.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(cycles.get('b')).toEqual(['a', 'b', 'c']);
  });

  it('treats a dependency on itself as a cycle', () => {
    expect(dependencyCycles([node('a', [dep('a')])]).get('a')).toEqual(['a']);
  });

  it('is empty for a diamond', () => {
    expect(
      dependencyCycles([
        node('a', [dep('b'), dep('c')]),
        node('b', [dep('d')]),
        node('c', [dep('d')]),
        node('d'),
      ]).size,
    ).toBe(0);
  });
});

describe('orderByDependencies', () => {
  const ids = (nodes: readonly DependencyNode[]) => nodes.map(({ id }) => id);

  it('puts a dependency before its dependent and keeps the rest in order', () => {
    expect(
      ids(
        orderByDependencies([
          node('a', [dep('c')]),
          node('b'),
          node('c', [dep('d')]),
          node('d'),
        ]),
      ),
    ).toEqual(['d', 'c', 'a', 'b']);
  });

  it('ignores missing dependencies and survives a cycle', () => {
    expect(
      ids(orderByDependencies([node('a', [dep('x')]), node('b')])),
    ).toEqual(['a', 'b']);
    expect(
      ids(orderByDependencies([node('a', [dep('b')]), node('b', [dep('a')])])),
    ).toHaveLength(2);
  });
});

describe('dependencyIssues', () => {
  const run = (nodes: DependencyNode[], target: string, off: string[] = []) =>
    dependencyIssues(
      nodes.find(({ id }) => id === target)!,
      {
        nodes,
        isOn: ({ id }) => !off.includes(id),
        cycles: dependencyCycles(nodes),
      },
    );

  it('names the three reasons with id, range and the found version', () => {
    const nodes = [
      node('app', [dep('gone'), dep('off', '>=1.0.0'), dep('old', '>=2.0.0')]),
      node('off'),
      node('old', [], '1.5.0'),
    ];
    expect(run(nodes, 'app', ['off'])).toEqual([
      { code: 'dependency-missing', data: { id: 'gone' } },
      { code: 'dependency-disabled', data: { id: 'off', range: '>=1.0.0' } },
      {
        code: 'dependency-version',
        data: { id: 'old', range: '>=2.0.0', found: '1.5.0' },
      },
    ]);
  });

  it('accepts versions on the range edges', () => {
    const range = '>=1.0.0 <2.0.0';
    const at = (version: string) =>
      run([node('app', [dep('lib', range)]), node('lib', [], version)], 'app');
    expect(at('1.0.0')).toEqual([]);
    expect(at('1.99.9')).toEqual([]);
    expect(at('2.0.0')).toHaveLength(1);
    expect(at('0.9.9')).toHaveLength(1);
  });

  it('blames a dependency that is itself not loaded', () => {
    const nodes = [node('app', [dep('mid')]), node('mid', [dep('gone')])];
    expect(run(nodes, 'app')).toEqual([
      { code: 'dependency-unmet', data: { id: 'mid' } },
    ]);
    expect(run(nodes, 'mid')).toEqual([
      { code: 'dependency-missing', data: { id: 'gone' } },
    ]);
  });

  it('gives a cycle member only the cycle and its dependent an unmet dependency', () => {
    const nodes = [
      node('a', [dep('b')]),
      node('b', [dep('a')]),
      node('c', [dep('a')]),
    ];
    expect(run(nodes, 'a')).toEqual([
      { code: 'dependency-cycle', data: { cycle: ['a', 'b'] } },
    ]);
    expect(run(nodes, 'c')).toEqual([
      { code: 'dependency-unmet', data: { id: 'a' } },
    ]);
  });
});

describe('policy and registry', () => {
  it('without dependencies nothing changes', () => {
    const { stateOf, policy } = open(extension('acme.a'));
    expect(stateOf('acme.a')).toBe('loaded');
    expect(policy.dependencyIssues('acme.a')).toEqual([]);
  });

  it('an extension whose dependency is missing is unmet, has no contributions and structured diagnostics', () => {
    const { registry, stateOf, policy } = open(
      extension('acme.app', [dep('acme.lib', '>=1.0.0')]),
    );
    expect(stateOf('acme.app')).toBe('dependencies-unmet');
    expect(policy.isEnabled('acme.app')).toBe(false);
    expect(registry.contributions().commands).toEqual([]);
    const [info] = registry.list();
    expect(info?.dependencies).toEqual([{ id: 'acme.lib', range: '>=1.0.0' }]);
    expect(info?.diagnostics).toEqual([
      {
        code: 'dependency-missing',
        data: { id: 'acme.lib', range: '>=1.0.0' },
      },
    ]);
    expect(formatDiagnostic(info!.diagnostics[0]!)).toBe(
      "requires extension 'acme.lib' >=1.0.0, which is not installed",
    );
  });

  it('a version outside the range is unmet and names the found version', () => {
    const { registry, stateOf } = open(
      extension('acme.app', [dep('acme.lib', '>=2.0.0')]),
      extension('acme.lib'),
    );
    expect(stateOf('acme.app')).toBe('dependencies-unmet');
    expect(stateOf('acme.lib')).toBe('loaded');
    expect(
      registry.list().find(({ id }) => id === 'acme.app')?.diagnostics,
    ).toEqual([
      {
        code: 'dependency-version',
        data: { id: 'acme.lib', range: '>=2.0.0', found: '1.0.0' },
      },
    ]);
  });

  it('disabling the dependency recomputes the dependent at once, enabling restores it', () => {
    const { stateOf, disable, policy, registry } = open(
      extension('acme.app', [dep('acme.lib')]),
      extension('acme.lib'),
    );
    expect(stateOf('acme.app')).toBe('loaded');
    disable('acme.lib');
    expect(stateOf('acme.lib')).toBe('disabled');
    expect(stateOf('acme.app')).toBe('dependencies-unmet');
    expect(policy.isEnabled('acme.app')).toBe(false);
    expect(registry.contributions().commands).toEqual([]);
    expect(
      registry.list().find(({ id }) => id === 'acme.app')?.diagnostics,
    ).toEqual([{ code: 'dependency-disabled', data: { id: 'acme.lib' } }]);
    disable();
    expect(stateOf('acme.app')).toBe('loaded');
    expect(registry.contributions().commands).toHaveLength(2);
  });

  it('a user-disabled dependent is disabled, not unmet', () => {
    const { stateOf, disable, codesOf } = open(
      extension('acme.app', [dep('acme.lib')]),
    );
    disable('acme.app');
    expect(stateOf('acme.app')).toBe('disabled');
    expect(codesOf('acme.app')).toEqual([]);
  });

  it('a dependency that is itself unmet leaves its dependent unmet (transitive)', () => {
    const { stateOf, codesOf, disable } = open(
      extension('acme.top', [dep('acme.mid')]),
      extension('acme.mid', [dep('acme.base')]),
      extension('acme.base'),
    );
    expect(stateOf('acme.top')).toBe('loaded');
    disable('acme.base');
    expect(stateOf('acme.mid')).toBe('dependencies-unmet');
    expect(stateOf('acme.top')).toBe('dependencies-unmet');
    expect(codesOf('acme.top')).toEqual(['dependency-unmet']);
  });

  it('a snapshot replacement is seen at once: the dependency arrives', () => {
    const { holder, stateOf } = open(extension('acme.app', [dep('acme.lib')]));
    expect(stateOf('acme.app')).toBe('dependencies-unmet');
    holder.replace(
      discoveryOf([
        extension('acme.app', [dep('acme.lib')]),
        extension('acme.lib'),
      ]),
    );
    expect(stateOf('acme.app')).toBe('loaded');
  });

  it('cycle members are unmet with a cycle diagnostic', () => {
    const { stateOf, registry } = open(
      extension('acme.a', [dep('acme.b')]),
      extension('acme.b', [dep('acme.a')]),
    );
    expect(stateOf('acme.a')).toBe('dependencies-unmet');
    expect(stateOf('acme.b')).toBe('dependencies-unmet');
    expect(registry.list()[0]?.diagnostics).toEqual([
      { code: 'dependency-cycle', data: { cycle: ['acme.a', 'acme.b'] } },
    ]);
  });

  it('a bundled extension can be the dependency and is never disabled', () => {
    const { stateOf, disable } = open(
      extension('dolphy.core', [], { origin: 'bundled' }),
      extension('acme.app', [dep('dolphy.core')]),
    );
    disable('dolphy.core');
    expect(stateOf('dolphy.core')).toBe('loaded');
    expect(stateOf('acme.app')).toBe('loaded');
  });

  it('contributions of a dependency are registered before those of its dependent', () => {
    const { registry } = open(
      ...orderByDependencies([
        extension('acme.app', [dep('acme.lib')]),
        extension('acme.lib'),
      ]),
    );
    expect(registry.contributions().commands.map((c) => c.extensionId)).toEqual(
      ['acme.lib', 'acme.app'],
    );
  });
});

describe('discoverExtensions: order', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'dolphy-deps-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const write = async (id: string, dependencies: unknown[] = []) => {
    const dir = path.join(root, id);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'extension.json'),
      JSON.stringify({
        id,
        version: '1.0.0',
        apiVersion: 1,
        main: './main.mjs',
        dependencies,
        contributes: { gradePolicies: [{ id, label: id }] },
      }),
    );
  };

  it('lists a dependency before its dependent even when it sorts later', async () => {
    await write('acme.a', [{ id: 'acme.z' }]);
    await write('acme.m');
    await write('acme.z');
    const result = await discoverExtensions({
      roots: [{ dir: root, origin: 'user' }],
      logger: createLogger(),
      verifyFiles: false,
    });
    expect(result.extensions.map(({ id }) => id)).toEqual([
      'acme.z',
      'acme.a',
      'acme.m',
    ]);
    expect(result.extensions[1]?.dependencies).toEqual([
      { id: 'acme.z', range: null },
    ]);
  });

  it('keeps an extension with a missing dependency in the set (the state is the policy’s)', async () => {
    await write('acme.a', [{ id: 'acme.nowhere' }]);
    const result = await discoverExtensions({
      roots: [{ dir: root, origin: 'user' }],
      logger: createLogger(),
      verifyFiles: false,
    });
    expect(result.extensions.map(({ id }) => id)).toEqual(['acme.a']);
    expect(result.diagnostics).toEqual([]);
  });
});
