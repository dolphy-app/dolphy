import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli/run.ts';
import { REPO_ROOT, makeTemp } from './helpers.ts';

const run = async (argv: string[], cwd: string) => {
  let stdout = '';
  let stderr = '';
  const code = await runCli(
    argv,
    {
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
    },
    cwd,
  );
  return { code, stdout, stderr };
};

describe('runCli', () => {
  it('success: code 0, relative directory resolved against cwd, steps in stdout', async () => {
    const cwd = await makeTemp();
    const { code, stdout, stderr } = await run(
      ['acme-hello', '--local', REPO_ROOT],
      cwd,
    );
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain(`cd ${path.join(cwd, 'acme-hello')}`);
    expect(stdout).toContain(
      `DOLPHY_DEV_EXTENSIONS=${path.join(cwd, 'acme-hello', 'dist-ext')} pnpm dev`,
    );
    expect(stdout).not.toContain('are not published');
    await expect(
      readFile(path.join(cwd, 'acme-hello', 'extension.json'), 'utf8'),
    ).resolves.toContain('"id": "acme-hello"');
  });

  it('without --local prints a note about unpublished packages', async () => {
    const cwd = await makeTemp();
    const { code, stdout } = await run(['acme-hello'], cwd);
    expect(code).toBe(0);
    expect(stdout).toContain('are not published');
  });

  it('--local relative path is resolved against cwd', async () => {
    const cwd = await makeTemp();
    const rel = path.relative(cwd, REPO_ROOT);
    const { code } = await run(['acme-hello', '--local', rel], cwd);
    expect(code).toBe(0);
    const pkg = await readFile(
      path.join(cwd, 'acme-hello/package.json'),
      'utf8',
    );
    expect(pkg).toContain(`link:${REPO_ROOT}/packages/extension-sdk`);
  });

  it('non-empty directory: code 1 and message in stderr', async () => {
    const cwd = await makeTemp();
    await mkdir(path.join(cwd, 'acme-hello'));
    await writeFile(path.join(cwd, 'acme-hello', 'a.txt'), '');
    const { code, stdout, stderr } = await run(['acme-hello'], cwd);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('is not empty');
  });

  it.each([
    ['no arguments', []],
    ['unknown flag', ['x', '--nope']],
    ['--id without a value', ['x', '--id']],
    ['extra argument', ['a', 'b']],
  ])('%s — code 2 and usage', async (_name, argv) => {
    const cwd = await makeTemp();
    const { code, stdout, stderr } = await run(argv, cwd);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('usage: create-dolphy-extension');
  });

  it('id cannot be derived from the directory name: code 2 asking for --id', async () => {
    const cwd = await makeTemp();
    const { code, stderr } = await run(['2024'], cwd);
    expect(code).toBe(2);
    expect(stderr).toContain('--id');
  });

  it('explicit --id rescues such a directory', async () => {
    const cwd = await makeTemp();
    const { code } = await run(['2024', '--id', 'acme.hello'], cwd);
    expect(code).toBe(0);
  });

  it('--template picks the project kind', async () => {
    const cwd = await makeTemp();
    const { code, stderr } = await run(['x', '--template', 'theme'], cwd);
    expect(code, stderr).toBe(0);
    const manifest = await readFile(path.join(cwd, 'x/extension.json'), 'utf8');
    expect(manifest).toContain('"themes"');
    await expect(readFile(path.join(cwd, 'x/src/index.ts'))).rejects.toThrow();
  });

  it('an unknown --template: code 2 and the list of names', async () => {
    const cwd = await makeTemp();
    const { code, stdout, stderr } = await run(
      ['x', '--template', 'fancy'],
      cwd,
    );
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain("unknown template 'fancy'");
    expect(stderr).toContain('exercise, theme, command-panel, events, blank');
    await expect(readFile(path.join(cwd, 'x/package.json'))).rejects.toThrow();
  });

  it('--template without a value: code 2', async () => {
    const cwd = await makeTemp();
    const { code, stderr } = await run(['x', '--template'], cwd);
    expect(code).toBe(2);
    expect(stderr).toContain('--template requires a value');
  });

  it('--help: code 0, usage in stdout', async () => {
    const cwd = await makeTemp();
    const { code, stdout } = await run(['--help'], cwd);
    expect(code).toBe(0);
    expect(stdout).toContain('usage: create-dolphy-extension');
  });
});
