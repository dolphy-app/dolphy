#!/usr/bin/env node
/**
 * Проверка собранных пакетов (`pnpm build:packages` → `dist-publish/`): упаковка
 * `npm pack`, состав tarball'ов, установка всех четырёх в пустой проект, генерация
 * проекта расширения из установленного `create-dolphy-extension` и его сборка,
 * проверка, типы и тесты. Запускается в CI, не в `pnpm test` (нужна сеть: сторонние
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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectImports } from './lib/imports.mjs';
import {
  PACKAGES,
  REGISTRY,
  SCOPE,
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
    JSON.stringify(manifest.files) === '["dist"]',
    `${name}: files is not ["dist"]`,
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

const assertEntries = ({ name, entries }) => {
  for (const entry of entries) {
    const allowed =
      entry === 'package.json' ||
      entry === 'README.md' ||
      entry.startsWith('dist/');
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

const assertExports = ({ manifest, dir }) => {
  const targets = Object.values(manifest.exports ?? {}).flatMap((entry) =>
    Object.values(entry),
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
  assertEntries({ name, entries: tarball.entries });
  check(
    listFiles(dir).length === tarball.entries.length,
    `${name}: tarball content differs from the pack listing`,
  );
  assertManifest({ manifest, spec });
  assertBins({ spec, dir });
  assertExports({ manifest, dir });
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
const pointAtTarballs = ({ project, tarballs }) => {
  const file = path.join(project, 'package.json');
  const manifest = readJson(file);
  const sdk = `${SCOPE}/extension-sdk`;
  const tools = `${SCOPE}/extension-tools`;
  const api = `${SCOPE}/extension-api`;
  check(
    manifest.devDependencies?.[sdk] !== undefined &&
      manifest.devDependencies?.[tools] !== undefined,
    'generated project does not depend on extension-sdk and extension-tools',
  );
  manifest.devDependencies[sdk] = toFileSpec(tarballs[sdk].file);
  manifest.devDependencies[tools] = toFileSpec(tarballs[tools].file);
  manifest.overrides = { [api]: toFileSpec(tarballs[api].file) };
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
};

const assertGeneratedProject = ({ demo, version }) => {
  const manifest = readJson(path.join(demo, 'package.json'));
  for (const name of [`${SCOPE}/extension-sdk`, `${SCOPE}/extension-tools`]) {
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

    step('dolphy-ext build / validate, tsc, npm test');
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
