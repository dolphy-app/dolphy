#!/usr/bin/env node
/**
 * Сборка публикуемых пакетов (`@dolphy-app/extension-api|keybindings|ui|sdk|tools|create-extension`)
 * в `dist-publish/<каталог пакета>/`: собранный JS, `.d.ts`, сгенерированные
 * `package.json` и README. Рабочие пакеты остаются `private`: публикуется только
 * сгенерированный каталог.
 *
 * Запуск: `pnpm build:packages [--version X.Y.Z]` (по умолчанию — версия корня).
 */
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'tsdown';
import { collectImports } from './lib/imports.mjs';
import {
  PACKAGES,
  SCOPE,
  assetFiles,
  binFiles,
  createManifest,
  createRangeResolver,
  deriveDependencies,
  docFiles,
  isBareSpecifier,
  isValidVersion,
  packageName,
  renderReadme,
} from './lib/package-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist-publish');
const README_TEMPLATE = path.join(ROOT, 'tools/templates/package-readme.md');
/** Заменяется константой при сборке `create-extension`; в исходниках не определена. */
const VERSION_CONSTANT = '__DOLPHY_PACKAGE_VERSION__';
const SHEBANG = '#!/usr/bin/env node';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

const listFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
};

const workspaceManifests = async () => {
  const dirs = await readdir(path.join(ROOT, 'packages'), {
    withFileTypes: true,
  });
  const manifests = await Promise.all(
    dirs
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        readJson(path.join(ROOT, 'packages', entry.name, 'package.json')).catch(
          () => null,
        ),
      ),
  );
  return manifests.filter((manifest) => manifest !== null);
};

/** Внешние: всё из `node_modules` и встроенное; внутренние пакеты `@dolphy-app/*` вшиваются. */
const externalPredicate = (spec) => {
  const siblings = new Set(spec.siblings.map((dir) => `${SCOPE}/${dir}`));
  return (id) => {
    if (!isBareSpecifier(id)) return false;
    if (id.startsWith(`${SCOPE}/`)) {
      return [...siblings].some((name) => id === name);
    }
    return true;
  };
};

const bundle = async ({ spec, sourceDir, distDir, version }) => {
  const isExternal = externalPredicate(spec);
  await build({
    config: false,
    cwd: ROOT,
    entry: Object.fromEntries(
      Object.entries(spec.entries).map(([name, file]) => [
        name,
        path.join(sourceDir, file),
      ]),
    ),
    outDir: distDir,
    clean: true,
    format: 'esm',
    platform: spec.dts ? 'neutral' : 'node',
    tsconfig: path.join(sourceDir, 'tsconfig.json'),
    dts: spec.dts,
    sourcemap: false,
    minify: false,
    define: { [VERSION_CONSTANT]: JSON.stringify(version) },
    deps: { neverBundle: isExternal, dts: { neverBundle: isExternal } },
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    logLevel: 'warn',
    report: false,
    publint: false,
    attw: false,
  });
};

const importsOf = async (distDir) => {
  const files = (await listFiles(distDir)).filter((file) =>
    /\.(js|d\.ts)$/.test(file),
  );
  const found = new Set();
  for (const file of files) {
    for (const specifier of collectImports(await readFile(file, 'utf8'))) {
      if (file.endsWith('.d.ts') && /\.ts$/.test(specifier)) {
        throw new Error(`${file}: declaration imports '${specifier}'`);
      }
      found.add(specifier);
    }
  }
  return [...found].sort();
};

const prepareBins = async ({ spec, packageDir }) => {
  for (const file of binFiles(spec)) {
    const target = path.join(packageDir, file);
    const code = await readFile(target, 'utf8');
    if (!code.startsWith(`${SHEBANG}\n`)) {
      throw new Error(`${target} has no '${SHEBANG}' shebang`);
    }
    await chmod(target, 0o755);
  }
};

const buildPackage = async ({ spec, version, rootManifest, workspace }) => {
  const sourceDir = path.join(ROOT, 'packages', spec.dir);
  const packageDir = path.join(OUT_DIR, spec.dir);
  const distDir = path.join(packageDir, 'dist');
  const source = await readJson(path.join(sourceDir, 'package.json'));

  await bundle({ spec, sourceDir, distDir, version });
  for (const file of assetFiles(spec)) {
    await copyFile(path.join(sourceDir, file), path.join(distDir, file));
  }
  const docs = docFiles(spec);
  if (docs.length > 0) {
    const docsDir = path.join(packageDir, 'docs');
    await mkdir(docsDir, { recursive: true });
    for (const file of docs) {
      await copyFile(
        path.join(sourceDir, 'docs', file),
        path.join(docsDir, file),
      );
    }
  }

  const dependencies = deriveDependencies({
    spec,
    imports: await importsOf(distDir),
    resolveRange: createRangeResolver({ own: source, workspace }),
    version,
  });
  const manifest = createManifest({
    spec,
    source,
    rootManifest,
    version,
    dependencies,
  });
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    path.join(packageDir, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    path.join(packageDir, 'README.md'),
    renderReadme({
      template: await readFile(README_TEMPLATE, 'utf8'),
      spec,
      source,
      version,
    }),
  );
  await prepareBins({ spec, packageDir });
  return { name: packageName(spec), dir: packageDir, dependencies };
};

const parseArgs = (argv, defaultVersion) => {
  let version = defaultVersion;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--version') throw new Error(`unknown argument ${argv[i]}`);
    version = argv[++i];
  }
  if (version === undefined || !isValidVersion(version)) {
    throw new Error(`'${version}' is not a valid semver version`);
  }
  return { version };
};

const main = async () => {
  const rootManifest = await readJson(path.join(ROOT, 'package.json'));
  const { version } = parseArgs(process.argv.slice(2), rootManifest.version);
  const workspace = await workspaceManifests();
  for (const spec of PACKAGES) {
    const result = await buildPackage({
      spec,
      version,
      rootManifest,
      workspace,
    });
    const dependencies = Object.entries(result.dependencies)
      .map(([name, range]) => `${name}@${range}`)
      .join(', ');
    console.log(
      `${result.name}@${version} → ${path.relative(ROOT, result.dir)}` +
        ` (dependencies: ${dependencies || 'none'})`,
    );
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
