import {
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli/run.ts';
import { buildExtension } from '../src/index.ts';
import { bundleFindings } from '../src/lint/bundle.ts';
import { formatLintFinding, lintProject } from '../src/lint/index.ts';
import { declaredText, manifestFindings } from '../src/lint/manifest.ts';
import { copyProject, makeTemp } from './helpers.ts';

const PUBLICATION = {
  name: 'Night',
  description: 'A dark theme for late evening lessons',
  author: 'octo-cat',
  tags: ['theme'],
};

const readyProject = async (
  fixture: string,
  manifest: Record<string, unknown> = {},
  readme: string | null = '# Night\n',
): Promise<string> => {
  const dir = await copyProject(fixture);
  const file = path.join(dir, 'extension.json');
  const current = JSON.parse(await readFile(file, 'utf8')) as Record<
    string,
    unknown
  >;
  await writeFile(
    file,
    JSON.stringify({ ...current, ...PUBLICATION, ...manifest }),
  );
  if (readme !== null) await writeFile(path.join(dir, 'README.md'), readme);
  return dir;
};

const lint = async (root: string, built?: string): Promise<string[]> =>
  (await lintProject({ root, ...(built === undefined ? {} : { built }) })).map(
    formatLintFinding,
  );

const builtWith = async (files: Record<string, string>): Promise<string> => {
  const dir = await makeTemp();
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), text);
  }
  return dir;
};

/** `@dolphy-app/extension-sdk` and `zod` as in an author's `node_modules`. */
const linkRpcDependencies = async (root: string): Promise<void> => {
  const packages = fileURLToPath(new URL('../..', import.meta.url));
  const modules = path.join(root, 'node_modules');
  await mkdir(path.join(modules, '@dolphy-app'), { recursive: true });
  for (const name of ['extension-sdk', 'extension-api']) {
    await symlink(
      path.join(packages, name),
      path.join(modules, '@dolphy-app', name),
      'dir',
    );
  }
  await symlink(
    await realpath(path.join(packages, 'extension-sdk/node_modules/zod')),
    path.join(modules, 'zod'),
    'dir',
  );
};

describe('dolphy-ext lint: project', () => {
  it('a complete project with a clean build has no findings', async () => {
    expect(await lint(await readyProject('theme-only'))).toEqual([]);
    expect(await lint(await readyProject('hello'))).toEqual([]);
  });

  it('manifest metadata problems are warnings that name the field', async () => {
    const dir = await readyProject('theme-only', {
      name: undefined,
      description: 'Too short',
      author: undefined,
      tags: undefined,
    });
    expect(await lint(dir)).toEqual([
      "warning acme.night CHECK-003 name: 'name' is not set: the catalog requires it",
      "warning acme.night CHECK-003 author: 'author' is not set: the catalog requires it",
      'warning acme.night CHECK-019 description: description is shorter than 20 characters: say what the extension does',
      "warning acme.night LINT-001 tags: 'tags' is not set: the catalog lists the extension without tags",
    ]);
  });

  it('a missing or blank README is the only error', async () => {
    for (const readme of [null, '  \n']) {
      const dir = await readyProject('theme-only', {}, readme);
      expect(await lint(dir)).toEqual([
        'error acme.night CHECK-004 README.md: README.md is missing or empty',
      ]);
    }
  });

  it('a project with a localized name and description is read and linted', async () => {
    const dir = await readyProject('theme-only', {
      name: { en: 'Night', ru: 'Ночь' },
      description: {
        en: 'A dark theme for late evening lessons',
        ru: 'Тёмная тема для вечерних занятий',
      },
      minAppVersion: '0.7.0',
    });
    expect(await lint(dir)).toEqual([]);

    const old = await readyProject('theme-only', {
      name: { en: 'Night', ru: 'Ночь' },
    });
    expect(await lint(old)).toEqual([
      'warning acme.night CHECK-032 minAppVersion: a localized name or description is rejected by apps before 0.7.0: set minAppVersion to 0.7.0 or newer',
    ]);
  });

  it('finds code smells in the build of the project itself', async () => {
    const dir = await readyProject('hello');
    const source = path.join(dir, 'src/index.ts');
    await writeFile(
      source,
      `${await readFile(source, 'utf8')}
export const probe = (code: string): unknown => globalThis.eval(code);
globalThis.probe = probe;
`,
    );
    // the module is shared by the server and the client bundles
    expect(await lint(dir)).toEqual([
      'warning acme.hello CHECK-022 client.mjs: dynamic code execution (eval or new Function)',
      'warning acme.hello CHECK-022 main.mjs: dynamic code execution (eval or new Function)',
    ]);
  });

  it('a build with zod (defineRpc) has no findings: zod only calls new Function("")', async () => {
    const dir = await readyProject('zod-rpc');
    await linkRpcDependencies(dir);
    const { dir: built } = await buildExtension({
      root: dir,
      outDir: path.join(dir, 'out'),
    });
    // the build contains the probe that the rule has to skip
    expect(await readFile(path.join(built, 'main.mjs'), 'utf8')).toContain(
      'new Function("")',
    );
    expect(await lint(dir)).toEqual([]);
    expect(await lint(dir, built)).toEqual([]);
  });

  it('--built checks the given directory instead of building', async () => {
    const dir = await readyProject('theme-only');
    const built = await builtWith({
      'main.mjs': 'export default { activate() { eval("1"); } };',
    });
    expect(await lint(dir, built)).toEqual([
      'warning acme.night CHECK-022 main.mjs: dynamic code execution (eval or new Function)',
    ]);
  });

  it('a directory without extension.json and a bad --built are usage errors', async () => {
    const empty = await makeTemp();
    await expect(lintProject({ root: empty })).rejects.toThrow(
      /extension.json is unreadable/,
    );
    const dir = await readyProject('theme-only');
    await expect(
      lintProject({ root: dir, built: path.join(empty, 'nope') }),
    ).rejects.toThrow(/--built: not a directory/);
  });
});

describe('dolphy-ext lint: bundle heuristics', () => {
  const file = (text: string, name = 'main.mjs') => [{ path: name, text }];
  const rules = (text: string) =>
    bundleFindings(file(text)).map((item) => item.ruleId);

  it('eval and new Function, but not identifiers that merely contain them', () => {
    expect(rules('const x = eval("1");')).toEqual(['CHECK-022']);
    expect(rules('const f = new  Function("a", "return a");')).toEqual([
      'CHECK-022',
    ]);
    expect(rules('const retrieval = evaluate(1); medieval(2);')).toEqual([]);
  });

  it('new Function("") with an empty string only is not dynamic code', () => {
    for (const code of [
      'new Function("")',
      "new Function('')",
      'new Function(``)',
      'new  Function( "" )',
      'try { new Function(""); } catch { allowed = false; }',
    ]) {
      expect(rules(code), code).toEqual([]);
    }
    for (const code of [
      'new Function(code)',
      'new Function("return 1")',
      "new Function('a', 'return a')",
      'new Function("", "return 1")',
      'new Function(" ")',
      'new Function("" + code)',
      'eval("")',
      'new Function(""); new Function(code);',
    ]) {
      expect(rules(code), code).toEqual(['CHECK-022']);
    }
  });

  it('obfuscation: long lines in a big file, or many _0x identifiers', () => {
    expect(rules(`${'a'.repeat(21_000)}\n`)).toEqual(['CHECK-023']);
    expect(rules(`${'a = 1;\n'.repeat(5000)}`)).toEqual([]);
    expect(rules(`${'a'.repeat(600)}\n`)).toEqual([]);
    const ids = Array.from({ length: 20 }, (_, i) => `_0x${1000 + i}`);
    expect(rules(`var ${ids.join(', ')};`)).toEqual(['CHECK-023']);
    expect(rules(`var ${ids.slice(0, 19).join(', ')};`)).toEqual([]);
  });

  it('an embedded source map is an error', () => {
    const [finding] = bundleFindings(
      file('x();\n//# sourceMappingURL=data:application/json;base64,e30='),
    );
    expect(finding?.ruleId).toBe('CHECK-025');
    expect(finding?.severity).toBe('error');
  });
});

describe('dolphy-ext lint: manifestFindings', () => {
  const fields = {
    name: declaredText('N'),
    author: 'a',
    tags: ['theme'],
    description: declaredText('x'.repeat(20)),
    minAppVersion: null,
  };

  it('twenty characters are enough', () => {
    expect(manifestFindings(fields)).toEqual([]);
    expect(
      manifestFindings({
        ...fields,
        description: declaredText('x'.repeat(19)),
      }).map((item) => item.ruleId),
    ).toEqual(['CHECK-019']);
  });

  const localized = {
    ...fields,
    name: declaredText({ en: 'N', ru: 'Н' }),
    description: declaredText({ en: 'x'.repeat(20), ru: 'я'.repeat(20) }),
    minAppVersion: '0.7.0',
  };

  it('a localized name and description with minAppVersion 0.7.0 are clean', () => {
    expect(manifestFindings(localized)).toEqual([]);
  });

  it('each language of a localized description is measured and named', () => {
    const findings = manifestFindings({
      ...localized,
      description: declaredText({ en: 'x'.repeat(20), ru: 'коротко' }),
    });
    expect(findings.map((item) => `${item.ruleId} ${item.field}`)).toEqual([
      'CHECK-019 description.ru',
    ]);
  });

  it('a localized text without en is not set', () => {
    const findings = manifestFindings({
      ...localized,
      name: declaredText({ ru: 'Н' }),
    });
    expect(findings.map((item) => `${item.ruleId} ${item.field}`)).toEqual([
      'CHECK-003 name.en',
    ]);
  });

  it.each([null, '0.6.0', '0.6.9'])(
    'a localized text with minAppVersion %s warns that the old apps reject it',
    (minAppVersion) => {
      const findings = manifestFindings({ ...localized, minAppVersion });
      expect(findings.map((item) => item.ruleId)).toEqual(['CHECK-032']);
      expect(findings[0]?.field).toBe('minAppVersion');
    },
  );

  it('plain strings need no minAppVersion', () => {
    expect(manifestFindings({ ...fields, minAppVersion: '0.5.0' })).toEqual([]);
  });
});

describe('dolphy-ext lint: CLI', () => {
  const exec = async (args: string[]) => {
    let stdout = '';
    let stderr = '';
    const code = await runCli(args, {
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
    });
    return { code, stdout, stderr };
  };

  it('warnings exit 0, a missing README exits 1, bad arguments exit 2', async () => {
    const warned = await readyProject('theme-only', { tags: [] });
    const result = await exec(['lint', warned]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^warning acme\.night LINT-001 tags: /);

    const bad = await readyProject('theme-only', {}, null);
    expect((await exec(['lint', bad])).code).toBe(1);

    expect((await exec(['lint', '--bogus'])).code).toBe(2);
    expect((await exec(['lint', bad, '--built'])).code).toBe(2);
    expect((await exec(['lint', path.join(bad, 'missing')])).code).toBe(2);
  });

  it('a clean --built directory passes', async () => {
    const built = await builtWith({ 'client.mjs': 'export {};' });
    const dir = await readyProject('theme-only');
    const result = await exec(['lint', dir, '--built', built]);
    expect(result).toEqual({ code: 0, stdout: '', stderr: '' });
  });
});
