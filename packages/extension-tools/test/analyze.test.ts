import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeIndex, importsOf, stripBareImports } from '../src/analyze.ts';
import { makeTemp } from './helpers.ts';

const project = async (files: Record<string, string>): Promise<string> => {
  const root = await makeTemp();
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  return path.join(root, 'src', 'index.ts');
};

describe('analyzeIndex', () => {
  it('finds server and client exported as constants', async () => {
    const index = await project({
      'src/index.ts':
        'export const server = () => {};\nexport const client = () => {};\n',
    });
    expect(await analyzeIndex(index)).toMatchObject({
      hasServer: true,
      hasClient: true,
    });
  });

  it('reports a missing part', async () => {
    const index = await project({
      'src/index.ts': 'export const client = () => {};\n',
    });
    expect(await analyzeIndex(index)).toMatchObject({
      hasServer: false,
      hasClient: true,
    });
  });

  it('finds exports declared as functions and through a specifier list', async () => {
    const index = await project({
      'src/index.ts':
        'function run() {}\nexport function server() {}\nexport { run as client };\n',
    });
    expect(await analyzeIndex(index)).toMatchObject({
      hasServer: true,
      hasClient: true,
    });
  });

  it('follows relative re-exports, named and star, and reads the files it visited', async () => {
    const index = await project({
      'src/index.ts':
        "export { server } from './server.ts';\nexport * from './client.ts';\n",
      'src/server.ts': 'export const server = () => {};\n',
      'src/client.ts': 'export const client = () => {};\n',
    });
    const analysis = await analyzeIndex(index);
    expect(analysis).toMatchObject({ hasServer: true, hasClient: true });
    expect(analysis.files.map((file) => path.basename(file)).sort()).toEqual([
      'client.ts',
      'index.ts',
      'server.ts',
    ]);
  });

  it('a name that is only imported is not an export', async () => {
    const index = await project({
      'src/index.ts': "import { server } from './server.ts';\nvoid server;\n",
      'src/server.ts': 'export const server = () => {};\n',
    });
    expect(await analyzeIndex(index)).toMatchObject({
      hasServer: false,
      hasClient: false,
    });
  });
});

describe('built code inspection', () => {
  it('importsOf lists static, re-exported and dynamic specifiers', () => {
    const code =
      "import a from 'x';\nexport { b } from 'y';\nconst c = () => import('z');\n";
    expect([...importsOf(code)].sort()).toEqual(['x', 'y', 'z']);
  });

  it('stripBareImports drops only binding-less imports it is asked to', () => {
    const code =
      "import 'node:fs';\nimport 'keep';\nimport { a } from 'node:path';\nexport { a };\n";
    const result = stripBareImports(code, (specifier) =>
      specifier.startsWith('node:'),
    );
    expect(result).not.toContain("import 'node:fs'");
    expect(result).toContain("import 'keep'");
    expect(result).toContain("from 'node:path'");
  });
});
