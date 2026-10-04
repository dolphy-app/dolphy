/**
 * Описание публикуемых пакетов и генерация их `package.json`/README.
 * Чистые функции без файловой системы: сборку и запись делает `build-packages.mjs`.
 */

export const SCOPE = '@dolphy-app';
export const REGISTRY = 'https://registry.npmjs.org';
export const REPOSITORY_URL = 'git+https://github.com/dolphy-app/dolphy.git';
export const NODE_RANGE = '>=22.12';
export const DOCS_URL =
  'https://github.com/dolphy-app/dolphy/blob/main/docs/design/extensions.md';
const GUIDE_URL =
  'https://github.com/dolphy-app/dolphy/blob/main/packages/extension-sdk/docs';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * `entries` — точки входа бандла (имя файла в `dist` → исходник); `exports` — подпуть
 * пакета → имя точки входа (только пакеты с типами); `assets` — файлы из каталога
 * пакета, копируемые в `dist` и открытые подпутём `./<имя файла>`; `docs` — файлы каталога
 * `docs/` пакета, публикуются как `docs/<имя файла>` рядом с `dist`; `bin` — команда → точка входа;
 * `siblings` — публикуемые пакеты, остающиеся зависимостями (их типы видны в `.d.ts`).
 */
export const PACKAGES = [
  {
    dir: 'extension-api',
    entries: { index: 'src/index.ts' },
    exports: { '.': 'index' },
    assets: ['extension.schema.json'],
    bin: null,
    dts: true,
    sideEffects: true,
    siblings: [],
    usage: [
      'Types and constants of the public extension API: the manifest, exercise',
      'type handlers, the answer element contract. Usually installed',
      'transitively through `@dolphy-app/extension-sdk`, which re-exports all of',
      'it.',
      '',
      '```ts',
      "import { EXTENSION_API_VERSION } from '@dolphy-app/extension-api';",
      '```',
      '',
      'The package also ships `extension.schema.json`, a JSON Schema of',
      '`extension.json` for editors (`@dolphy-app/extension-api/extension.schema.json`).',
    ],
  },
  {
    dir: 'keybindings',
    entries: { index: 'src/index.ts' },
    exports: { '.': 'index' },
    bin: null,
    dts: true,
    sideEffects: false,
    siblings: [],
    usage: [
      'Framework-free keybinding registry core: key notation with a',
      'platform-aware `Mod`, layout-aware matching of keyboard events,',
      '`when` clauses with overlap analysis, a keymap with source precedence',
      'and conflict detection. No DOM and no dependencies.',
      '',
      '```ts',
      "import { buildKeymap, parseChord } from '@dolphy-app/keybindings';",
      '```',
    ],
  },
  {
    dir: 'extension-sdk',
    entries: {
      index: 'src/index.ts',
      runtime: 'src/runtime.ts',
      testing: 'src/testing.ts',
    },
    exports: { '.': 'index', './runtime': 'runtime', './testing': 'testing' },
    docs: [
      'debugging.md',
      'no-build.md',
      'quick-start.md',
      'recipe-command-panel.md',
      'recipe-event-storage.md',
      'recipe-exercise-type.md',
      'recipe-settings.md',
      'recipe-theme.md',
    ],
    bin: null,
    dts: true,
    sideEffects: false,
    siblings: ['extension-api'],
    usage: [
      '`@dolphy-app/extension-sdk` — extension code (`defineExtension`,',
      '`defineExerciseType`), answer views (`defineAnswerView`), panels,',
      'markdown renderers and test helpers (`@dolphy-app/extension-sdk/testing`).',
      'The package has no side effects: an extension `src/index.ts` can be',
      'imported in plain Node. Ids declared in `extension.json` become types',
      'through `.dolphy/ids.d.ts`, which `dolphy-ext types` generates.',
      '',
      '```ts',
      "import { defineExtension } from '@dolphy-app/extension-sdk';",
      "import { loadExerciseType } from '@dolphy-app/extension-sdk/testing';",
      '```',
      '',
      'The package ships a guide in `docs/` (`node_modules/@dolphy-app/extension-sdk/docs/`',
      'after the install): a',
      `[quick start](${GUIDE_URL}/quick-start.md), recipes for`,
      `[an exercise type](${GUIDE_URL}/recipe-exercise-type.md),`,
      `[a theme](${GUIDE_URL}/recipe-theme.md),`,
      `[a command and a panel](${GUIDE_URL}/recipe-command-panel.md),`,
      `[events and storage](${GUIDE_URL}/recipe-event-storage.md) and`,
      `[settings](${GUIDE_URL}/recipe-settings.md), a path`,
      `[without a build](${GUIDE_URL}/no-build.md) and notes on`,
      `[debugging](${GUIDE_URL}/debugging.md).`,
    ],
  },
  {
    dir: 'extension-tools',
    entries: { 'cli/main': 'src/cli/main.ts' },
    exports: null,
    bin: { 'dolphy-ext': 'cli/main' },
    dts: false,
    sideEffects: true,
    siblings: [],
    usage: [
      'The `dolphy-ext` command line for extension authors: builds a project',
      'into an extension directory, writes the typed ids of the manifest',
      '(`.dolphy/ids.d.ts`), validates the result and runs the installed app on',
      'a watch build (`dolphy-ext dev`).',
      '',
      '```sh',
      'npx dolphy-ext build',
      'npx dolphy-ext types',
      'npx dolphy-ext validate dist-ext/<id>',
      'npx dolphy-ext dev',
      'npx dolphy-ext --help',
      '```',
    ],
  },
  {
    dir: 'create-extension',
    entries: { 'cli/main': 'src/cli/main.ts' },
    exports: null,
    bin: { 'create-dolphy-extension': 'cli/main' },
    dts: false,
    sideEffects: true,
    siblings: [],
    usage: [
      'Generator of an extension project: `src/index.ts` with the host and a',
      'view, a manifest, tests, and typed ids (`.dolphy/ids.d.ts`, generated from',
      '`extension.json`).',
      '',
      '```sh',
      'npx @dolphy-app/create-extension <directory>',
      '```',
      '',
      'The project gets tests, a build and a README.',
    ],
  },
];

export const packageName = (spec) => `${SCOPE}/${spec.dir}`;

export const isValidVersion = (version) => VERSION_PATTERN.test(version);

/** Имя пакета из спецификатора импорта (`ajv/dist/2020.js` → `ajv`, `@a/b/c` → `@a/b`). */
export const packageOfSpecifier = (specifier) => {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

export const isBareSpecifier = (specifier) =>
  !specifier.startsWith('.') &&
  !specifier.startsWith('/') &&
  !/^[A-Za-z]:[\\/]/.test(specifier);

const isBuiltin = (specifier) => specifier.startsWith('node:');

const hasWorkspaceRange = (range) =>
  range.startsWith('workspace:') || range.startsWith('link:');

/**
 * Диапазоны сторонних зависимостей: сначала собственный `package.json` пакета, затем
 * `dependencies` остальных пакетов монорепозитория (вшитые закрытые пакеты тянут свои
 * библиотеки). Расхождение диапазонов в запасном списке — ошибка: выбор неочевиден.
 */
export const createRangeResolver = ({ own, workspace }) => {
  const fallback = new Map();
  for (const manifest of workspace) {
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (hasWorkspaceRange(range)) continue;
      const known = fallback.get(name) ?? new Set();
      known.add(range);
      fallback.set(name, known);
    }
  }
  return (name) => {
    const fromOwn =
      own.dependencies?.[name] ??
      own.devDependencies?.[name] ??
      own.peerDependencies?.[name];
    if (fromOwn !== undefined && !hasWorkspaceRange(fromOwn)) return fromOwn;
    const ranges = [...(fallback.get(name) ?? [])];
    if (ranges.length === 0) return null;
    if (ranges.length > 1) {
      throw new Error(
        `ambiguous range for '${name}': ${ranges.join(', ')}; declare it in the package itself`,
      );
    }
    return ranges[0];
  };
};

/**
 * `dependencies` опубликованного пакета по тому, что бандл действительно импортирует.
 * `imports` — спецификаторы из собранного JS и `.d.ts`.
 */
export const deriveDependencies = ({
  spec,
  imports,
  resolveRange,
  version,
}) => {
  const dependencies = {};
  const siblings = new Map(
    spec.siblings.map((dir) => [`${SCOPE}/${dir}`, version]),
  );
  for (const specifier of imports) {
    if (!isBareSpecifier(specifier) || isBuiltin(specifier)) continue;
    const name = packageOfSpecifier(specifier);
    if (name === packageName(spec)) continue;
    const range = siblings.get(name) ?? resolveRange(name);
    if (range === null) {
      throw new Error(
        `${packageName(spec)}: bundle imports '${name}', which is neither a builtin, ` +
          'a published sibling, nor a declared dependency',
      );
    }
    dependencies[name] = range;
  }
  return Object.fromEntries(
    Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
  );
};

const distPath = (entry, extension) => `./dist/${entry}${extension}`;

/** Файлы пакета, копируемые в `dist` как есть. */
export const assetFiles = (spec) => spec.assets ?? [];

/** Файлы руководства пакета: `docs/<имя>` в tarball. */
export const docFiles = (spec) => spec.docs ?? [];

/** Поле `files` опубликованного пакета. */
export const publishedFiles = (spec) =>
  docFiles(spec).length === 0 ? ['dist'] : ['dist', 'docs'];

const exportsField = (spec) =>
  spec.exports === null
    ? undefined
    : {
        ...Object.fromEntries(
          Object.entries(spec.exports).map(([subpath, entry]) => [
            subpath,
            {
              types: distPath(entry, '.d.ts'),
              default: distPath(entry, '.js'),
            },
          ]),
        ),
        ...Object.fromEntries(
          assetFiles(spec).map((file) => [`./${file}`, distPath(file, '')]),
        ),
      };

const binField = (spec) =>
  spec.bin === null
    ? undefined
    : Object.fromEntries(
        Object.entries(spec.bin).map(([command, entry]) => [
          command,
          distPath(entry, '.js'),
        ]),
      );

/** Файлы `bin` внутри опубликованного пакета (относительно его корня). */
export const binFiles = (spec) =>
  Object.values(binField(spec) ?? {}).map((file) => file.slice(2));

/** `package.json` опубликованного пакета. Порядок ключей стабилен. */
export const createManifest = ({
  spec,
  source,
  rootManifest,
  version,
  dependencies,
}) => {
  if (!isValidVersion(version)) {
    throw new Error(`'${version}' is not a valid semver version`);
  }
  const manifest = {
    name: packageName(spec),
    version,
    description: source.description,
    ...(rootManifest.license === undefined
      ? {}
      : { license: rootManifest.license }),
    type: 'module',
    ...(spec.sideEffects ? {} : { sideEffects: false }),
    ...(spec.exports === null ? {} : { exports: exportsField(spec) }),
    ...(spec.exports === null
      ? {}
      : { types: distPath(spec.exports['.'], '.d.ts') }),
    ...(spec.bin === null ? {} : { bin: binField(spec) }),
    files: publishedFiles(spec),
    dependencies,
    engines: { node: NODE_RANGE },
    repository: {
      type: 'git',
      url: REPOSITORY_URL,
      directory: `packages/${spec.dir}`,
    },
    publishConfig: { access: 'public', registry: REGISTRY },
  };
  const text = JSON.stringify(manifest);
  if (text.includes('workspace:') || text.includes('link:')) {
    throw new Error(
      `${manifest.name}: generated manifest contains a local range`,
    );
  }
  return manifest;
};

const fill = (template, values) =>
  template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    if (!(key in values)) throw new Error(`unknown template key '${key}'`);
    return values[key];
  });

/** README опубликованного пакета по шаблону `tools/templates/package-readme.md`. */
export const renderReadme = ({ template, spec, source, version }) =>
  fill(template, {
    name: packageName(spec),
    description: source.description,
    version,
    usage: spec.usage.join('\n'),
    registry: REGISTRY,
    scope: SCOPE,
    docsUrl: DOCS_URL,
  });
