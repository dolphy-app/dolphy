#!/usr/bin/env node
/**
 * Проверка собранных пакетов (`pnpm build:packages` → `dist-publish/`): упаковка
 * `npm pack`, состав tarball'ов, установка всех пакетов в пустой проект, генерация
 * проекта расширения из установленного `create-dolphy-extension` и его сборка,
 * проверка, типы и тесты; подпути `extension-ui` разрешаются, а вид, собранный из
 * них `dolphy-ext build`, укладывается в потолки размера и не тянет чужие подпути.
 * Запускается в CI, не в `pnpm test` (нужна сеть: сторонние
 * зависимости ставятся из npmjs).
 *
 * Запуск: `pnpm verify:packages [--keep]` (`--keep` не удаляет временный каталог).
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectImports } from './lib/imports.mjs';
import {
  PACKAGES,
  REGISTRY,
  SCOPE,
  assetFiles,
  docFiles,
  publishedFiles,
  binFiles,
  isBareSpecifier,
  packageName,
  packageOfSpecifier,
} from './lib/package-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist-publish');
const SHEBANG = '#!/usr/bin/env node';
const FORBIDDEN_RANGE = /^(workspace|link|file):/;

const fail = (message) => {
  throw new Error(message);
};

const check = (condition, message) => {
  if (!condition) fail(message);
};

const step = (message) => console.log(`\n▸ ${message}`);

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/**
 * Изолированное окружение npm: пользовательский `~/.npmrc`, токены, `npm_*` и `INIT_CWD`
 * (его задаёт `pnpm run`, а генератор считает его каталогом вызова) не участвуют.
 */
const createEnv = (home) => {
  const userconfig = path.join(home, 'user.npmrc');
  writeFileSync(userconfig, '');
  const inherited = Object.entries(process.env).filter(
    ([key]) =>
      !/^npm_/i.test(key) && !['INIT_CWD', 'NODE_AUTH_TOKEN'].includes(key),
  );
  const settings = [
    ['npm_config_userconfig', userconfig],
    ['npm_config_cache', path.join(home, 'npm-cache')],
    ['npm_config_update_notifier', 'false'],
    ['npm_config_audit', 'false'],
    ['npm_config_fund', 'false'],
  ];
  return Object.fromEntries([...inherited, ...settings]);
};

const run = (command, args, options) => {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    return fail(
      `${command} ${args.join(' ')} failed in ${options.cwd}\n${output}`,
    );
  }
};

const listFiles = (dir, prefix = '') =>
  readdirSync(path.join(dir, prefix), { withFileTypes: true }).flatMap(
    (entry) => {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? listFiles(dir, relative) : [relative];
    },
  );

const pack = ({ spec, tarballs, env }) => {
  const output = run(
    'npm',
    ['pack', '--pack-destination', tarballs, '--json'],
    { cwd: path.join(DIST, spec.dir), env },
  );
  const [result] = JSON.parse(output);
  return {
    file: path.join(tarballs, result.filename),
    size: result.size,
    unpackedSize: result.unpackedSize,
    entries: result.files.map((entry) => entry.path),
  };
};

const assertManifest = ({ manifest, spec }) => {
  const name = packageName(spec);
  check(manifest.name === name, `${name}: wrong name ${manifest.name}`);
  check(manifest.private === undefined, `${name}: manifest is private`);
  check(manifest.type === 'module', `${name}: type is not module`);
  check(
    manifest.publishConfig?.registry === REGISTRY &&
      manifest.publishConfig?.access === 'public',
    `${name}: publishConfig is not public access on ${REGISTRY}`,
  );
  check(
    manifest.repository?.directory === `packages/${spec.dir}`,
    `${name}: repository.directory is wrong`,
  );
  check(
    JSON.stringify(manifest.files) === JSON.stringify(publishedFiles(spec)),
    `${name}: files is not ${JSON.stringify(publishedFiles(spec))}`,
  );
  const ranges = [
    ...Object.values(manifest.dependencies ?? {}),
    ...Object.values(manifest.devDependencies ?? {}),
  ];
  check(
    !ranges.some((range) => FORBIDDEN_RANGE.test(range)),
    `${name}: local dependency range in package.json`,
  );
  check(
    !JSON.stringify(manifest).includes('workspace:'),
    `${name}: 'workspace:' found in package.json`,
  );
};

const assertEntries = ({ name, spec, entries }) => {
  const docs = docFiles(spec).map((file) => `docs/${file}`);
  for (const doc of docs) {
    check(
      entries.includes(doc),
      `${name}: guide file ${doc} is not in the tarball`,
    );
  }
  for (const entry of entries) {
    const allowed =
      entry === 'package.json' ||
      entry === 'README.md' ||
      entry.startsWith('dist/') ||
      docs.includes(entry);
    check(allowed, `${name}: unexpected file in tarball: ${entry}`);
    check(!entry.startsWith('src/'), `${name}: sources in tarball: ${entry}`);
    check(
      !/\.ts$/.test(entry) || entry.endsWith('.d.ts'),
      `${name}: TypeScript source in tarball: ${entry}`,
    );
  }
};

const assertBins = ({ spec, dir }) => {
  for (const file of binFiles(spec)) {
    const target = path.join(dir, file);
    check(existsSync(target), `${packageName(spec)}: bin ${file} is missing`);
    check(
      readFileSync(target, 'utf8').startsWith(`${SHEBANG}\n`),
      `${packageName(spec)}: ${file} has no shebang`,
    );
    check(
      (statSync(target).mode & 0o111) === 0o111,
      `${packageName(spec)}: ${file} is not executable in the tarball`,
    );
  }
};

const assertAssets = ({ spec, dir }) => {
  for (const file of assetFiles(spec)) {
    check(
      existsSync(path.join(dir, 'dist', file)),
      `${packageName(spec)}: asset dist/${file} is missing`,
    );
  }
};

const assertExports = ({ manifest, dir }) => {
  const targets = Object.values(manifest.exports ?? {}).flatMap((entry) =>
    typeof entry === 'string' ? [entry] : Object.values(entry),
  );
  for (const target of targets) {
    check(
      existsSync(path.join(dir, target)),
      `${manifest.name}: export target ${target} is missing`,
    );
  }
};

/** Всё, что импортируют JS и `.d.ts`, — встроенное, относительное или объявленная зависимость. */
const assertSelfContained = ({ manifest, dir }) => {
  const declared = new Set(Object.keys(manifest.dependencies ?? {}));
  for (const file of listFiles(dir).filter((item) =>
    /\.(js|d\.ts)$/.test(item),
  )) {
    const code = readFileSync(path.join(dir, file), 'utf8');
    for (const specifier of collectImports(code)) {
      if (!isBareSpecifier(specifier) || specifier.startsWith('node:')) {
        check(
          !(file.endsWith('.d.ts') && /\.ts$/.test(specifier)),
          `${manifest.name}: ${file} imports '${specifier}'`,
        );
        continue;
      }
      check(
        declared.has(packageOfSpecifier(specifier)),
        `${manifest.name}: ${file} imports undeclared '${specifier}'`,
      );
    }
  }
};

const inspectTarball = ({ spec, tarball, work }) => {
  const dir = path.join(work, spec.dir);
  mkdirSync(dir, { recursive: true });
  run('tar', ['-xzf', tarball.file, '-C', dir, '--strip-components=1'], {
    cwd: work,
  });
  const name = packageName(spec);
  const manifest = readJson(path.join(dir, 'package.json'));
  assertEntries({ name, spec, entries: tarball.entries });
  check(
    listFiles(dir).length === tarball.entries.length,
    `${name}: tarball content differs from the pack listing`,
  );
  assertManifest({ manifest, spec });
  assertBins({ spec, dir });
  assertExports({ manifest, dir });
  assertAssets({ spec, dir });
  assertSelfContained({ manifest, dir });
  return manifest;
};

const binOf = (project, command) => {
  const file = path.join(project, 'node_modules', '.bin', command);
  check(existsSync(file), `installed bin ${command} is missing`);
  return file;
};

const toFileSpec = (file) => `file:${file}`;

/** Зависимости проекта по ссылкам на локальные tarball'ы (реестра с ними ещё нет). */
const pointAtTarballs = ({ project, tarballs, uiKit = false }) => {
  const file = path.join(project, 'package.json');
  const manifest = readJson(file);
  const sdk = `${SCOPE}/extension-sdk`;
  const tools = `${SCOPE}/extension-tools`;
  const api = `${SCOPE}/extension-api`;
  check(
    manifest.devDependencies?.[sdk] !== undefined &&
      manifest.devDependencies?.[tools] !== undefined &&
      manifest.devDependencies?.[api] !== undefined,
    'generated project does not depend on extension-sdk, extension-tools and extension-api',
  );
  manifest.devDependencies[sdk] = toFileSpec(tarballs[sdk].file);
  manifest.devDependencies[tools] = toFileSpec(tarballs[tools].file);
  manifest.devDependencies[api] = toFileSpec(tarballs[api].file);
  if (uiKit) {
    manifest.devDependencies[`${SCOPE}/extension-ui`] = toFileSpec(
      tarballs[`${SCOPE}/extension-ui`].file,
    );
  }
  // транзитивный `extension-api` из SDK тоже берётся из локального tarball'а
  manifest.overrides = { [api]: `$${api}` };
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
};

const assertGeneratedProject = ({ demo, version }) => {
  const manifest = readJson(path.join(demo, 'package.json'));
  for (const name of [
    `${SCOPE}/extension-api`,
    `${SCOPE}/extension-sdk`,
    `${SCOPE}/extension-tools`,
  ]) {
    check(
      manifest.devDependencies[name] === `^${version}`,
      `demo: ${name} is ${manifest.devDependencies[name]}, expected ^${version}`,
    );
  }
  check(
    !existsSync(path.join(demo, '.npmrc')),
    'demo: .npmrc is generated, but the packages live in npmjs',
  );
  const readme = readFileSync(path.join(demo, 'README.md'), 'utf8');
  check(
    !readme.includes('_authToken') && !readme.includes('read:packages'),
    'demo: README still has a token section',
  );
};

/** `$schema` манифеста указывает на файл, который лежит в установленном пакете. */
const assertSchemaResolves = (demo) => {
  const { $schema } = readJson(path.join(demo, 'extension.json'));
  check(typeof $schema === 'string', 'demo: extension.json has no $schema');
  check(
    existsSync(path.resolve(demo, $schema)),
    `demo: $schema ${$schema} does not exist after install`,
  );
};

/** Из одного `src/index.ts` сборка кладёт код хоста только в `main.mjs`, код вида — только в `view.mjs`. */
const assertSplitOutputs = (dir) => {
  const main = readFileSync(path.join(dir, 'main.mjs'), 'utf8');
  const view = readFileSync(path.join(dir, 'view.mjs'), 'utf8');
  check(
    main.includes('referenceAnswer') && !main.includes('customElements'),
    'demo: main.mjs is not the host code alone',
  );
  check(
    view.includes('customElements.define') && !view.includes('referenceAnswer'),
    'demo: view.mjs is not the view code alone',
  );
};

const formatKb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

const UI_PACKAGE = `${SCOPE}/extension-ui`;

/** Подпути UI-кита (без корневого экспорта) и функции, которые каждый обязан открывать. */
const UI_SUBPATHS = {
  vuetify: ['mountComponent'],
  'vuetify/choice': ['mountRadioGroup', 'mountCheckboxGroup'],
  'vuetify/feedback': [
    'mountAlert',
    'mountChip',
    'mountProgress',
    'mountSkeleton',
  ],
  'vuetify/fields': [
    'mountTextarea',
    'mountSlider',
    'mountSwitch',
    'mountDateField',
  ],
  'vuetify/navigation': [
    'mountTabs',
    'mountDialog',
    'mountMenu',
    'mountTooltip',
  ],
  'vuetify/table': ['mountTable', 'mountDataTable'],
};

const KIB = 1024;

/**
 * Потолки размера (gzip, уровень 9) собранного `view.mjs` после минификации: JS и CSS
 * отдельно. Замерено на `vuetify` 4.0.x и `vue` 3.5.x (JS / CSS, КиБ) и округлено вверх
 * с запасом ~10%. Ключ — что импортирует вид: ядро (`core`), подпуть вместе с ядром или
 * все подпути (`all`).
 */
const UI_LIMITS = {
  core: { js: 49 * KIB, css: 30 * KIB }, // 44.6 / 26.7
  'vuetify/choice': { js: 64 * KIB, css: 32 * KIB }, // 57.6 / 28.6
  'vuetify/feedback': { js: 77 * KIB, css: 38 * KIB }, // 69.6 / 34.6
  'vuetify/fields': { js: 112 * KIB, css: 43 * KIB }, // 101.9 / 39.0
  'vuetify/navigation': { js: 102 * KIB, css: 40 * KIB }, // 92.8 / 36.3
  'vuetify/table': { js: 152 * KIB, css: 45 * KIB }, // 137.9 / 40.9
  all: { js: 184 * KIB, css: 54 * KIB }, // 167.4 / 49.1
};

/** Код, который подпуть Vuetify-кита не должен тянуть в чужие сборки (R5). */
const FORBIDDEN_IN_ISOLATED = {
  'vuetify/choice': ['VDataTable', 'VTabs', 'VTextarea', 'VAlert'],
  'vuetify/feedback': ['VDataTable', 'VRadioGroup', 'VTabs', 'VTextarea'],
  'vuetify/fields': ['VDataTable', 'VRadioGroup', 'VTabs', 'VAlert'],
  'vuetify/navigation': ['VDataTable', 'VRadioGroup', 'VTextarea', 'VAlert'],
  'vuetify/table': ['VRadioGroup', 'VTabs', 'VTextarea', 'VAlert'],
};

/** Компонент Vuetify, который подпуть обязан принести в бандл: без него проверка отсутствия чужих слов ничего не значит. */
const OWN_IN_ISOLATED = {
  'vuetify/choice': 'VRadioGroup',
  'vuetify/feedback': 'VAlert',
  'vuetify/fields': 'VTextarea',
  'vuetify/navigation': 'VTabs',
  'vuetify/table': 'VDataTable',
};

const installedUiDir = (consumer) =>
  path.join(consumer, 'node_modules', ...UI_PACKAGE.split('/'));

/**
 * Установленный пакет открывает ровно шесть подпутей, корень и внутренности `dist`
 * закрыты; каждый подпуть разрешается Node и отдаёт свои функции в `.d.ts`.
 */
const assertUiSubpaths = ({ consumer, env }) => {
  const dir = installedUiDir(consumer);
  const manifest = readJson(path.join(dir, 'package.json'));
  const expected = Object.keys(UI_SUBPATHS).map((name) => `./${name}`);
  check(
    JSON.stringify(Object.keys(manifest.exports).sort()) ===
      JSON.stringify([...expected].sort()),
    `extension-ui exports ${Object.keys(manifest.exports).join(', ')}, expected ${expected.join(', ')}`,
  );
  const resolve = (specifier) =>
    run(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `try { console.log(import.meta.resolve(${JSON.stringify(specifier)})); } catch (error) { console.log(error.code); }`,
      ],
      { cwd: consumer, env },
    ).trim();
  for (const name of Object.keys(UI_SUBPATHS)) {
    const resolved = resolve(`${UI_PACKAGE}/${name}`);
    check(
      resolved.endsWith(
        `/extension-ui/dist/${name === 'vuetify' ? 'vuetify/index' : name}.js`,
      ),
      `extension-ui/${name} resolves to ${resolved}`,
    );
    const types = readFileSync(
      path.join(
        dir,
        'dist',
        `${name === 'vuetify' ? 'vuetify/index' : name}.d.ts`,
      ),
      'utf8',
    );
    for (const fn of UI_SUBPATHS[name]) {
      check(
        types.includes(fn),
        `extension-ui/${name}: ${fn} is missing in the declarations`,
      );
    }
  }
  for (const closed of [UI_PACKAGE, `${UI_PACKAGE}/dist/vuetify/choice.js`]) {
    check(
      resolve(closed) === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
      `${closed} must not be resolvable`,
    );
  }
};

const gzipSize = (text) => gzipSync(Buffer.from(text), { level: 9 }).length;

/**
 * Размер `view.mjs`: CSS зависимостей лежит в бандле строками `.add("…")` реестра стилей;
 * они вырезаются, остальное минифицируется минификатором Vite из установленного проекта.
 */
const measureView = ({ project, file, env }) => {
  const code = readFileSync(file, 'utf8');
  const strings = [];
  const js = code.replace(
    /\.add\(("(?:[^"\\]|\\.)*")\)/g,
    (_match, literal) => {
      strings.push(JSON.parse(literal));
      return '.add("")';
    },
  );
  check(
    strings.length > 0,
    `${file}: no dependency style sheets in the bundle`,
  );
  const stripped = path.join(path.dirname(file), 'view.stripped.mjs');
  writeFileSync(stripped, js);
  const minified = run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { minifySync } from 'vite'; import { readFileSync } from 'node:fs'; process.stdout.write(minifySync('view.mjs', readFileSync(process.argv[1], 'utf8')).code);`,
      stripped,
    ],
    { cwd: project, env, maxBuffer: 64 * 1024 * 1024 },
  );
  rmSync(stripped);
  return {
    js: gzipSize(minified),
    css: gzipSize(strings.join('\n')),
    code: minified,
  };
};

const kitExtensionJson = {
  id: 'kit',
  version: '1.0.0',
  apiVersion: 1,
  contributes: {
    exerciseTypes: [
      {
        id: 'kit',
        specSchema: { type: 'object' },
        answerSchema: { type: 'string' },
      },
    ],
  },
};

/** `src/index.ts` вида, который импортирует и вызывает функции перечисленных подпутей. */
const kitSource = (subpaths) => {
  const imports = subpaths.map(
    (name) =>
      `import { ${UI_SUBPATHS[name].join(', ')} } from '${UI_PACKAGE}/${name}';`,
  );
  const calls = subpaths.flatMap((name) =>
    UI_SUBPATHS[name].map((fn) =>
      fn === 'mountComponent'
        ? 'mountComponent(container, (() => null) as never, {} as never);'
        : `${fn}(container, {} as never);`,
    ),
  );
  return `import {
  defineAnswerView,
  defineExerciseType,
  defineExtension,
} from '@dolphy-app/extension-sdk';
import type { ExtensionViews } from '@dolphy-app/extension-sdk';
${imports.join('\n')}

export const host = defineExtension({
  exerciseTypes: {
    kit: defineExerciseType<Record<string, never>, string, Record<string, never>>({
      project: () => ({}),
      grade: () => ({ outcome: 'passed' }),
      referenceAnswer: () => '',
    }),
  },
});

export const views = {
  kit: defineAnswerView((api) => {
    const container = document.createElement('div');
    api.root.append(container);
    ${calls.join('\n    ')}
    return { update: () => {} };
  }),
} satisfies ExtensionViews;
`;
};

/**
 * Размеры по ceilings R5/R6: из установленного `extension-ui` собирается вид, который
 * импортирует ядро, один подпуть, каждый подпуть и все сразу (`dolphy-ext build`
 * установленного пакета). Изолированный подпуть не тянет код чужих.
 */
const assertUiBundles = ({ kit, env }) => {
  const variants = [
    { label: 'core', subpaths: ['vuetify'], limits: UI_LIMITS.core },
    ...Object.keys(UI_SUBPATHS)
      .filter((name) => name !== 'vuetify')
      .map((name) => ({
        label: name,
        subpaths: ['vuetify', name],
        limits: UI_LIMITS[name],
      })),
    { label: 'all', subpaths: Object.keys(UI_SUBPATHS), limits: UI_LIMITS.all },
  ];
  writeFileSync(
    path.join(kit, 'extension.json'),
    `${JSON.stringify(kitExtensionJson, null, 2)}\n`,
  );
  for (const { label, subpaths, limits } of variants) {
    writeFileSync(path.join(kit, 'src', 'index.ts'), kitSource(subpaths));
    run('npx', ['--no-install', 'dolphy-ext', 'build'], { cwd: kit, env });
    const size = measureView({
      project: kit,
      file: path.join(kit, 'dist-ext', 'kit', 'view.mjs'),
      env,
    });
    check(
      size.js <= limits.js && size.css <= limits.css,
      `extension-ui ${label}: ${formatKb(size.js)} JS / ${formatKb(size.css)} CSS gzip, ` +
        `limits ${formatKb(limits.js)} / ${formatKb(limits.css)}`,
    );
    if (OWN_IN_ISOLATED[label] !== undefined) {
      check(
        size.code.includes(OWN_IN_ISOLATED[label]),
        `extension-ui ${label}: the bundle has no ${OWN_IN_ISOLATED[label]}`,
      );
    }
    for (const word of FORBIDDEN_IN_ISOLATED[label] ?? []) {
      check(
        !size.code.includes(word),
        `extension-ui ${label}: the bundle contains ${word} of another subpath`,
      );
    }
    console.log(
      `  extension-ui ${label}: ${formatKb(size.js)} JS + ${formatKb(size.css)} CSS gzip`,
    );
  }
};

const main = () => {
  const keep = process.argv.includes('--keep');
  check(existsSync(DIST), 'dist-publish is missing: run `pnpm build:packages`');
  const work = mkdtempSync(path.join(tmpdir(), 'dolphy-verify-'));
  const env = createEnv(work);
  let succeeded = false;
  try {
    step('npm pack and tarball contents');
    const tarballs = {};
    const tarballDir = path.join(work, 'tarballs');
    mkdirSync(tarballDir);
    let version = null;
    for (const spec of PACKAGES) {
      const tarball = pack({ spec, tarballs: tarballDir, env });
      const manifest = inspectTarball({
        spec,
        tarball,
        work: path.join(work, 'unpacked'),
      });
      version ??= manifest.version;
      check(manifest.version === version, `${manifest.name}: version differs`);
      tarballs[packageName(spec)] = tarball;
      console.log(
        `  ${manifest.name}@${manifest.version}: ${formatKb(tarball.size)} packed, ` +
          `${formatKb(tarball.unpackedSize)} unpacked, ${tarball.entries.length} files`,
      );
    }

    step('install all tarballs into an empty project');
    const consumer = path.join(work, 'consumer');
    mkdirSync(consumer);
    writeFileSync(
      path.join(consumer, 'package.json'),
      '{ "name": "consumer", "version": "1.0.0", "private": true }\n',
    );
    run(
      'npm',
      [
        'install',
        '--install-links=false',
        ...Object.values(tarballs).map((tarball) => tarball.file),
      ],
      { cwd: consumer, env },
    );
    run(binOf(consumer, 'dolphy-ext'), ['--help'], { cwd: consumer, env });
    assertUiSubpaths({ consumer, env });

    step('create-dolphy-extension demo');
    run(binOf(consumer, 'create-dolphy-extension'), ['demo'], {
      cwd: consumer,
      env,
    });
    const demo = path.join(consumer, 'demo');
    assertGeneratedProject({ demo, version });

    step('install demo dependencies from the tarballs');
    pointAtTarballs({ project: demo, tarballs });
    run('npm', ['install'], { cwd: demo, env });

    step('size and isolation of the extension-ui subpaths');
    run(binOf(consumer, 'create-dolphy-extension'), ['kit'], {
      cwd: consumer,
      env,
    });
    const kit = path.join(consumer, 'kit');
    pointAtTarballs({ project: kit, tarballs, uiKit: true });
    run('npm', ['install'], { cwd: kit, env });
    assertUiBundles({ kit, env });

    step('dolphy-ext build / validate, tsc, npm test');
    assertSchemaResolves(demo);
    run('npx', ['--no-install', 'dolphy-ext', 'build'], { cwd: demo, env });
    run('npx', ['--no-install', 'dolphy-ext', 'validate', 'dist-ext/demo'], {
      cwd: demo,
      env,
    });
    assertSplitOutputs(path.join(demo, 'dist-ext', 'demo'));
    run('npx', ['--no-install', 'tsc', '--noEmit'], { cwd: demo, env });
    const testOutput = run('npm', ['test'], { cwd: demo, env });
    check(
      testOutput.includes('passed'),
      'demo: npm test reported no passing tests',
    );
    succeeded = true;
    console.log('\nAll package checks passed.');
  } finally {
    if (keep || !succeeded) {
      console.log(`\nWork directory kept: ${work}`);
    } else {
      rmSync(work, { recursive: true, force: true });
    }
  }
};

try {
  main();
} catch (error) {
  console.error(`\nverify:packages failed: ${error.message}`);
  process.exitCode = 1;
}
