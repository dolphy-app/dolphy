import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import { collectImports } from './imports.mjs';
import {
  PACKAGES,
  binFiles,
  createManifest,
  createRangeResolver,
  deriveDependencies,
  derivePeerDependencies,
  isValidVersion,
  packageOfSpecifier,
  renderReadme,
} from './package-manifest.mjs';

const specOf = (dir) => PACKAGES.find((spec) => spec.dir === dir);

const source = (extra = {}) => ({ description: 'описание', ...extra });

const manifestOf = (dir, overrides = {}) =>
  createManifest({
    spec: specOf(dir),
    source: source(),
    rootManifest: {},
    version: '1.2.3',
    dependencies: {},
    ...overrides,
  });

const resolverWith = ({ own = {}, workspace = [] } = {}) =>
  createRangeResolver({ own, workspace });

describe('руководство пакета SDK', () => {
  it('docs в описании пакета — ровно файлы каталога docs', () => {
    const dir = new URL('../../packages/extension-sdk/docs/', import.meta.url);
    assert.deepEqual(readdirSync(dir).sort(), [
      ...specOf('extension-sdk').docs,
    ]);
  });

  it('только SDK публикует docs', () => {
    for (const spec of PACKAGES) {
      assert.equal(spec.docs !== undefined, spec.dir === 'extension-sdk');
    }
  });
});

describe('derivePeerDependencies', () => {
  it('диапазон peer берётся из peerDependencies исходного пакета', () => {
    const peers = derivePeerDependencies({
      spec: specOf('extension-sdk'),
      source: {
        peerDependencies: { vue: '^3.5' },
        devDependencies: { vue: '^3.5.35' },
      },
    });
    assert.deepEqual(peers, { vue: '^3.5' });
  });

  it('peer без объявления в исходном пакете — ошибка', () => {
    assert.throws(
      () =>
        derivePeerDependencies({ spec: specOf('extension-sdk'), source: {} }),
      /peer 'vue'/,
    );
  });

  it('пакет без peers не получает peerDependencies', () => {
    assert.deepEqual(
      derivePeerDependencies({ spec: specOf('extension-api'), source: {} }),
      {},
    );
  });

  it('peer не попадает в dependencies', () => {
    const dependencies = deriveDependencies({
      spec: specOf('extension-sdk'),
      imports: ['vue', 'ajv'],
      resolveRange: (name) => (name === 'ajv' ? '^8' : null),
      version: '1.2.3',
    });
    assert.deepEqual(dependencies, { ajv: '^8' });
  });
});

describe('createManifest', () => {
  it('пакет с типами: exports с types/default и верхний types', () => {
    const manifest = manifestOf('extension-sdk');
    assert.deepEqual(manifest.exports, {
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './client': {
        types: './dist/client.d.ts',
        default: './dist/client.js',
      },
      './rpc': { types: './dist/rpc.d.ts', default: './dist/rpc.js' },
      './testing': {
        types: './dist/testing.d.ts',
        default: './dist/testing.js',
      },
    });
    assert.equal(manifest.types, './dist/index.d.ts');
    assert.equal(manifest.bin, undefined);
  });

  it('SDK объявляет vue peer-зависимостью, остальные пакеты peer не пишут', () => {
    const manifest = manifestOf('extension-sdk', {
      peerDependencies: { vue: '^3.5' },
    });
    assert.deepEqual(manifest.peerDependencies, { vue: '^3.5' });
    assert.equal(manifestOf('extension-api').peerDependencies, undefined);
  });

  it('extension-api открывает hook-schemas и схему манифеста подпутём на dist/extension.schema.json', () => {
    assert.deepEqual(manifestOf('extension-api').exports, {
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './hook-schemas': {
        types: './dist/hook-schemas.d.ts',
        default: './dist/hook-schemas.js',
      },
      './extension.schema.json': './dist/extension.schema.json',
    });
  });

  it('sideEffects: false только у SDK, остальные пакеты поле не пишут', () => {
    assert.equal(manifestOf('extension-sdk').sideEffects, false);
    for (const dir of [
      'extension-api',
      'extension-tools',
      'create-extension',
    ]) {
      assert.equal(manifestOf(dir).sideEffects, undefined);
    }
  });

  it('CLI-пакет: только bin, без exports и types', () => {
    const tools = manifestOf('extension-tools');
    assert.deepEqual(tools.bin, { 'dolphy-ext': './dist/cli/main.js' });
    const create = manifestOf('create-extension');
    assert.deepEqual(create.bin, {
      'create-dolphy-extension': './dist/cli/main.js',
    });
    for (const manifest of [tools, create]) {
      assert.equal(manifest.exports, undefined);
      assert.equal(manifest.types, undefined);
    }
    assert.deepEqual(binFiles(specOf('extension-tools')), ['dist/cli/main.js']);
  });

  it('публикуемые поля: реестр, репозиторий, files, engines; не private', () => {
    for (const spec of PACKAGES) {
      const manifest = manifestOf(spec.dir);
      assert.equal(manifest.name, `@dolphy-app/${spec.dir}`);
      assert.equal(manifest.version, '1.2.3');
      assert.equal(manifest.type, 'module');
      assert.equal(manifest.private, undefined);
      assert.deepEqual(
        manifest.files,
        spec.dir === 'extension-sdk' ? ['dist', 'docs'] : ['dist'],
      );
      assert.deepEqual(manifest.engines, { node: '>=22.12' });
      assert.deepEqual(manifest.publishConfig, {
        access: 'public',
        registry: 'https://registry.npmjs.org',
      });
      assert.deepEqual(manifest.repository, {
        type: 'git',
        url: 'git+https://github.com/dolphy-app/dolphy.git',
        directory: `packages/${spec.dir}`,
      });
    }
  });

  it('license копируется из корня, если он задан', () => {
    assert.equal(manifestOf('extension-api').license, undefined);
    const licensed = manifestOf('extension-api', {
      rootManifest: { license: 'MIT' },
    });
    assert.equal(licensed.license, 'MIT');
  });

  it('локальный диапазон в зависимостях — ошибка', () => {
    assert.throws(
      () =>
        manifestOf('extension-sdk', {
          dependencies: { '@dolphy-app/extension-api': 'workspace:*' },
        }),
      /local range/,
    );
  });

  it('версия не semver — ошибка', () => {
    assert.throws(
      () => manifestOf('extension-api', { version: '1.2' }),
      /semver/,
    );
  });
});

describe('isValidVersion', () => {
  it('принимает X.Y.Z и пререлизы, отклоняет остальное', () => {
    for (const version of ['0.1.0', '10.20.30', '1.0.0-rc.1']) {
      assert.equal(isValidVersion(version), true, version);
    }
    for (const version of ['1.0', 'v1.0.0', '1.0.0+build', '', '^1.0.0']) {
      assert.equal(isValidVersion(version), false, version);
    }
  });
});

describe('deriveDependencies', () => {
  const derive = (dir, imports, resolver = resolverWith()) =>
    deriveDependencies({
      spec: specOf(dir),
      imports,
      resolveRange: resolver,
      version: '1.2.3',
    });

  it('встроенные модули и относительные импорты не зависимости', () => {
    assert.deepEqual(
      derive('create-extension', ['node:fs', 'node:path', './chunk.js']),
      {},
    );
  });

  it('подпуть пакета сводится к имени; диапазон из собственного package.json', () => {
    const resolver = resolverWith({ own: { dependencies: { ajv: '^8' } } });
    assert.deepEqual(derive('extension-sdk', ['ajv/dist/2020.js'], resolver), {
      ajv: '^8',
    });
  });

  it('публикуемый соседний пакет получает точную версию релиза', () => {
    assert.deepEqual(derive('extension-sdk', ['@dolphy-app/extension-api']), {
      '@dolphy-app/extension-api': '1.2.3',
    });
  });

  it('библиотека вшитого закрытого пакета берётся из его package.json', () => {
    const resolver = resolverWith({
      workspace: [{ dependencies: { zod: '4.6.5' } }],
    });
    assert.deepEqual(derive('extension-tools', ['zod'], resolver), {
      zod: '4.6.5',
    });
  });

  it('результат отсортирован по имени', () => {
    const resolver = resolverWith({
      own: { dependencies: { vite: '^8', ajv: '^8' } },
    });
    assert.deepEqual(
      Object.keys(derive('extension-tools', ['vite', 'ajv'], resolver)),
      ['ajv', 'vite'],
    );
  });

  it('просочившийся закрытый пакет монорепозитория — ошибка', () => {
    assert.throws(
      () => derive('extension-tools', ['@dolphy-app/extension-host']),
      /extension-host/,
    );
  });

  it('импорт без объявленного диапазона — ошибка', () => {
    assert.throws(() => derive('extension-tools', ['left-pad']), /left-pad/);
  });

  it('разные диапазоны одной библиотеки в запасных пакетах — ошибка', () => {
    const resolver = resolverWith({
      workspace: [
        { dependencies: { zod: '4.6.5' } },
        { dependencies: { zod: '^3' } },
      ],
    });
    assert.throws(
      () => derive('extension-tools', ['zod'], resolver),
      /ambiguous/,
    );
  });

  it('диапазоны workspace: не попадают в результат', () => {
    const resolver = resolverWith({
      own: { dependencies: { zod: 'workspace:*' } },
    });
    assert.throws(() => derive('extension-tools', ['zod'], resolver), /zod/);
  });
});

describe('packageOfSpecifier', () => {
  it('имя пакета с scope и без', () => {
    assert.equal(packageOfSpecifier('ajv/dist/2020.js'), 'ajv');
    assert.equal(
      packageOfSpecifier('@dolphy-app/extension-api'),
      '@dolphy-app/extension-api',
    );
    assert.equal(packageOfSpecifier('@a/b/c/d'), '@a/b');
  });
});

describe('renderReadme', () => {
  const template = '# {{name}}\n{{description}}\n{{usage}}\n{{version}}\n';

  it('подставляет поля пакета', () => {
    const text = renderReadme({
      template,
      spec: specOf('extension-tools'),
      source: source(),
      version: '1.2.3',
    });
    assert.match(text, /^# @dolphy-app\/extension-tools\n/);
    assert.match(text, /npx dolphy-ext build/);
    assert.ok(!text.includes('{{'));
  });

  it('неизвестный ключ шаблона — ошибка', () => {
    assert.throws(
      () =>
        renderReadme({
          template: '{{nope}}',
          spec: specOf('extension-api'),
          source: source(),
          version: '1.2.3',
        }),
      /nope/,
    );
  });
});

describe('collectImports', () => {
  it('находит статические, реэкспорт и динамические импорты', () => {
    const code = [
      "import a from 'pkg-a';",
      "export * from '@scope/b';",
      "export { x } from './local.js';",
      "const lazy = () => import('pkg-c/sub');",
    ].join('\n');
    assert.deepEqual(collectImports(code), [
      './local.js',
      '@scope/b',
      'pkg-a',
      'pkg-c/sub',
    ]);
  });

  it('текст импорта внутри строки или шаблона — не импорт', () => {
    const code = [
      "import real from 'real-pkg';",
      "const tpl = `import x from '@dolphy-app/extension-sdk';`;",
      'const str = "import y from \'other\'";',
    ].join('\n');
    assert.deepEqual(collectImports(code), ['real-pkg']);
  });
});
