import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  ExtensionDiagnosticDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import { targetFromEntry } from '@/pages/settings/lib/catalog.ts';
import {
  dependencyMessageParams,
  rowsOfCatalog,
  rowsOfInstalled,
} from '@/pages/settings/lib/dependencies.ts';
import { describeDetails } from '@/pages/settings/lib/extension-details.ts';
import { hasSwitches } from '@/pages/settings/model/extensions.ts';
import { useInstalledExtensions } from '@/pages/settings/model/installed.ts';
import {
  catalogEntry,
  catalogVersion,
  createEventBus,
  extensionInfo,
  flush,
} from './support/extensions-fakes.ts';

const LIB = { id: 'acme.lib', range: '>=1.0.0 <2.0.0' };

const unmet = (
  diagnostics: ExtensionDiagnosticDto[],
  dependencies = [LIB, { id: 'acme.other', range: null }],
) =>
  extensionInfo('acme.app', {
    origin: 'user',
    toggleable: true,
    state: 'dependencies-unmet',
    dependencies,
    diagnostics,
  });

describe('rowsOfInstalled', () => {
  it('a loaded extension has every dependency ok', () => {
    const info = extensionInfo('acme.app', { dependencies: [LIB] });
    expect(rowsOfInstalled(info)).toEqual([{ ...LIB, status: 'ok' }]);
  });

  it('an unmet one takes the status from the diagnostic of that dependency, the rest are ok', () => {
    const info = unmet([
      {
        code: 'dependency-version',
        data: { id: 'acme.lib', range: LIB.range, found: '2.1.0' },
      },
    ]);
    expect(rowsOfInstalled(info)).toEqual([
      { ...LIB, status: 'version' },
      { id: 'acme.other', range: null, status: 'ok' },
    ]);
  });

  it.each([
    ['dependency-missing', 'missing'],
    ['dependency-disabled', 'disabled'],
    ['dependency-unmet', 'unmet'],
  ] as const)('%s → %s', (code, status) => {
    const info = unmet([{ code, data: { id: 'acme.lib' } }], [LIB]);
    expect(rowsOfInstalled(info)[0]?.status).toBe(status);
  });

  it('members of a cycle are unmet', () => {
    const info = unmet(
      [{ code: 'dependency-cycle', data: { cycle: ['acme.app', 'acme.lib'] } }],
      [LIB],
    );
    expect(rowsOfInstalled(info)[0]?.status).toBe('unmet');
  });

  it('a disabled extension shows no statuses: nothing was evaluated', () => {
    const info = extensionInfo('acme.app', {
      state: 'disabled',
      dependencies: [LIB],
    });
    expect(rowsOfInstalled(info)).toEqual([{ ...LIB, status: null }]);
  });
});

describe('rowsOfCatalog', () => {
  const installedLib = (version: string, state: 'loaded' | 'disabled') =>
    extensionInfo('acme.lib', { version, state });

  it('marks installed, missing and a version outside the range', () => {
    const rows = (version: string) =>
      rowsOfCatalog([LIB], [installedLib(version, 'loaded')])[0]?.status;
    expect(rows('1.5.0')).toBe('installed');
    expect(rows('2.0.0')).toBe('version');
    expect(rowsOfCatalog([LIB], [])[0]?.status).toBe('missing');
  });

  it('a disabled extension still counts as installed; an overridden record does not', () => {
    expect(
      rowsOfCatalog([LIB], [installedLib('1.0.0', 'disabled')])[0]?.status,
    ).toBe('installed');
    expect(
      rowsOfCatalog(
        [LIB],
        [extensionInfo('acme.lib', { state: 'overridden', version: '1.0.0' })],
      )[0]?.status,
    ).toBe('missing');
  });

  it('a dependency without a range accepts any version', () => {
    expect(
      rowsOfCatalog(
        [{ id: 'acme.lib', range: null }],
        [installedLib('9.9.9', 'loaded')],
      )[0]?.status,
    ).toBe('installed');
  });

  it('without the installed list nothing is marked', () => {
    expect(rowsOfCatalog([LIB], null)).toEqual([{ ...LIB, status: null }]);
  });
});

describe('dependencyMessageParams', () => {
  it('prefixes a range with a space, leaves it empty without one, joins a cycle', () => {
    expect(
      dependencyMessageParams({
        code: 'dependency-missing',
        data: { id: 'acme.lib', range: '>=1.0.0' },
      }),
    ).toMatchObject({ id: 'acme.lib', range: ' >=1.0.0' });
    expect(
      dependencyMessageParams({
        code: 'dependency-missing',
        data: { id: 'acme.lib' },
      }).range,
    ).toBe('');
    expect(
      dependencyMessageParams({
        code: 'dependency-cycle',
        data: { cycle: ['a', 'b'] },
      }).cycle,
    ).toBe('a, b');
  });
});

describe('rows and switches', () => {
  it('an unmet extension keeps its switches: the user may still turn it off', () => {
    expect(hasSwitches(unmet([]))).toBe(true);
  });

  it('install target and details carry the dependencies of the shown version', () => {
    const version = catalogVersion('1.0.0', { dependencies: [LIB] });
    const entry = catalogEntry('acme.app', { latest: version });
    expect(targetFromEntry(entry, version).dependencies).toEqual([LIB]);
    const details = describeDetails('acme.app', null, entry, null, null, [
      extensionInfo('acme.lib', { version: '1.2.0' }),
    ]);
    expect(details?.dependencies).toEqual([{ ...LIB, status: 'installed' }]);
    const installed = describeDetails(
      'acme.app',
      unmet([{ code: 'dependency-missing', data: { id: 'acme.lib' } }], [LIB]),
      null,
      null,
      null,
    );
    expect(installed?.dependencies).toEqual([{ ...LIB, status: 'missing' }]);
  });
});

describe('useInstalledExtensions', () => {
  it('loads the list and reloads it when the set of extensions changes', async () => {
    const bus = createEventBus();
    let calls = 0;
    const engine = {
      subscribe: bus.subscribe,
      extensions: {
        list: async () => {
          calls += 1;
          return [extensionInfo(`acme.v${calls}`)];
        },
      },
    } as unknown as LearningEngine;
    const installed = effectScope().run(() => useInstalledExtensions(engine))!;
    expect(installed.value).toBeNull();
    await flush();
    expect(installed.value?.map(({ id }) => id)).toEqual(['acme.v1']);
    bus.emit({ type: 'contributions-changed', generation: 2 });
    await flush();
    expect(installed.value?.map(({ id }) => id)).toEqual(['acme.v2']);
  });
});
