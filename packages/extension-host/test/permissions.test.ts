import { EXTENSION_PERMISSIONS } from '@spirula/extension-api';
import { describe, expect, it } from 'vitest';
import {
  RESTRICTED_ENV,
  grantFlags,
  permissionFlag,
  restrictedArgs,
} from '../src/permissions.ts';

describe('разрешения → флаги Node', () => {
  it.each([
    ['library.read', []],
    ['network', []],
    ['process.spawn', ['--allow-child-process']],
    ['worker.threads', ['--allow-worker']],
    ['native.addons', ['--allow-addons']],
  ] as const)('%s', (permission, flags) => {
    expect(grantFlags([permission])).toEqual(flags);
  });

  it('каждое объявленное разрешение даёт только флаги --allow-*', () => {
    expect(grantFlags([])).toEqual([]);
    for (const permission of EXTENSION_PERMISSIONS) {
      for (const flag of grantFlags([permission])) {
        expect(flag).toMatch(/^--allow-[a-z-]+$/);
      }
    }
  });

  it('несколько разрешений объединяются без повторов', () => {
    expect(
      grantFlags([
        'process.spawn',
        'library.read',
        'worker.threads',
        'native.addons',
        'process.spawn',
      ]),
    ).toEqual(['--allow-child-process', '--allow-worker', '--allow-addons']);
  });
});

describe('флаг режима разрешений по версии Node', () => {
  it.each([
    ['22.12.0', '--experimental-permission'],
    ['22.12.9', '--experimental-permission'],
    ['22.13.0', '--permission'],
    ['22.22.3', '--permission'],
    ['24.21.0', '--permission'],
    ['20.19.0', '--experimental-permission'],
  ])('%s → %s', (version, flag) => {
    expect(permissionFlag(version)).toBe(flag);
  });
});

describe('аргументы ограниченного процесса', () => {
  it('чтение — только перечисленные каталоги, гранты после них, вход последним', () => {
    expect(
      restrictedArgs({
        readDirs: ['/ext/acme', '/app/restricted'],
        entry: '/app/restricted/ext-restricted.mjs',
        permissions: ['process.spawn', 'network'],
        nodeVersion: '24.21.0',
      }),
    ).toEqual([
      '--permission',
      '--allow-fs-read=/ext/acme',
      '--allow-fs-read=/app/restricted',
      '--allow-child-process',
      '/app/restricted/ext-restricted.mjs',
    ]);
  });

  it('окружение ограниченного процесса — ровно одна переменная', () => {
    expect(RESTRICTED_ENV).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
  });
});
