import { extname } from 'node:path';
import { mergeConfig, parseAst } from 'vite';
import type { InlineConfig, Plugin } from 'vite';
import { reactPreset } from './react.ts';
import { vuePreset } from './vue.ts';

/** What a preset knows about the project it is applied to. */
export interface PresetContext {
  /** Id of the extension from the manifest. */
  extensionId: string;
}

/**
 * A UI framework of the client file: the source files it adds (`extensions`),
 * the plugins that compile them and the additions to the Vite configuration of
 * the client build. The server file and the workers never see presets.
 */
export interface FrameworkPreset {
  /** Name in `frameworks` of `dolphy-ext.config.json`. */
  name: string;
  /** Source file extensions only this preset compiles (with the dot). */
  extensions: readonly string[];
  /** npm packages of the runtime of the framework: what the client file bundles or takes from the host (`@scope` for a whole scope). */
  packages: readonly string[];
  plugins(context: PresetContext): Plugin[] | Promise<Plugin[]>;
  options?: InlineConfig;
}

const PRESETS: readonly FrameworkPreset[] = [vuePreset, reactPreset];

/** The window is a Vue application, so this preset is always on. */
const ALWAYS_ON = vuePreset.name;

export const FRAMEWORK_NAMES: readonly string[] = PRESETS.map(
  (preset) => preset.name,
);

export const DEFAULT_FRAMEWORKS: readonly string[] = [ALWAYS_ON];

export const isFramework = (name: string): boolean =>
  FRAMEWORK_NAMES.includes(name);

/** `frameworks` of the config as it is used: no repeats, the always-on preset first. */
export const normalizeFrameworks = (names: readonly string[]): string[] => [
  ...new Set([ALWAYS_ON, ...names]),
];

const presetsOf = (frameworks: readonly string[]): FrameworkPreset[] =>
  PRESETS.filter((preset) => frameworks.includes(preset.name));

/**
 * Modules of the runtime packages of the frameworks in `frameworks`. The server
 * file shares `src/index.ts` with the client file and must not keep what it
 * imports of them (a component defined at the top level of `src/index.ts` is not
 * code of the server), so their top level does not count as code with effects
 * there: tree shaking drops the library together with the component.
 */
export const frameworkPackagePattern = (
  frameworks: readonly string[],
): RegExp =>
  new RegExp(
    `[\\\\/]node_modules[\\\\/](?:${presetsOf(frameworks)
      .flatMap((preset) => preset.packages)
      .join('|')})[\\\\/]`,
  );

const hasJsx = (node: unknown): boolean => {
  if (typeof node !== 'object' || node === null) return false;
  if (Array.isArray(node)) return node.some(hasJsx);
  const { type } = node as { type?: unknown };
  if (type === 'JSXElement' || type === 'JSXFragment') return true;
  return Object.values(node).some(hasJsx);
};

const SOURCE_LANG: Record<string, 'tsx' | 'jsx'> = {
  '.tsx': 'tsx',
  '.jsx': 'jsx',
};

/**
 * A source file of a preset that is not on, with markup in it: without the
 * check the bundler would fail on an import of the runtime of a framework
 * that is not installed, with no word about the config.
 */
const disabledPresetGuard = (disabled: readonly FrameworkPreset[]): Plugin => ({
  name: 'dolphy-ext:disabled-presets',
  enforce: 'pre',
  transform(code, id) {
    const file = id.split('?')[0] ?? id;
    const extension = extname(file);
    const lang = SOURCE_LANG[extension];
    if (lang === undefined) return null;
    const owner = disabled.find((preset) =>
      preset.extensions.includes(extension),
    );
    if (owner === undefined || !hasJsx(parseAst(code, { lang }).body)) {
      return null;
    }
    return this.error(
      `'${file}' contains JSX, which needs the '${owner.name}' framework: add "frameworks": ["${owner.name}"] to dolphy-ext.config.json`,
    );
  },
});

/** Plugins of the client build: those of the presets in `frameworks` and the check for the files of the others. */
export const presetPlugins = async (
  frameworks: readonly string[],
  context: PresetContext,
): Promise<Plugin[]> => {
  const enabled = presetsOf(frameworks);
  const disabled = PRESETS.filter((preset) => !enabled.includes(preset));
  const groups = await Promise.all(
    enabled.map((preset) => preset.plugins(context)),
  );
  return [disabledPresetGuard(disabled), ...groups.flat()];
};

/** Vite configuration of the client build with the additions of the presets in `frameworks`. */
export const presetConfig = (
  frameworks: readonly string[],
  config: InlineConfig,
): InlineConfig =>
  presetsOf(frameworks).reduce<InlineConfig>(
    (merged, preset) =>
      preset.options === undefined
        ? merged
        : mergeConfig(merged, preset.options),
    config,
  );
