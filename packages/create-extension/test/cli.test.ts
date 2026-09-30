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
  it('успех: код 0, относительный каталог считается от cwd, шаги в stdout', async () => {
    const cwd = await makeTemp();
    const { code, stdout, stderr } = await run(
      ['acme-hello', '--local', REPO_ROOT],
      cwd,
    );
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain(`cd ${path.join(cwd, 'acme-hello')}`);
    expect(stdout).toContain(
      `SPIRULA_DEV_EXTENSIONS=${path.join(cwd, 'acme-hello', 'dist-ext')} pnpm dev`,
    );
    expect(stdout).not.toContain('не опубликованы');
    await expect(
      readFile(path.join(cwd, 'acme-hello', 'extension.json'), 'utf8'),
    ).resolves.toContain('"id": "acme-hello"');
  });

  it('без --local печатает замечание о неопубликованных пакетах', async () => {
    const cwd = await makeTemp();
    const { code, stdout } = await run(['acme-hello'], cwd);
    expect(code).toBe(0);
    expect(stdout).toContain('не опубликованы');
  });

  it('--local относительный путь считается от cwd', async () => {
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

  it('непустой каталог — код 1 и сообщение в stderr', async () => {
    const cwd = await makeTemp();
    await mkdir(path.join(cwd, 'acme-hello'));
    await writeFile(path.join(cwd, 'acme-hello', 'a.txt'), '');
    const { code, stdout, stderr } = await run(['acme-hello'], cwd);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('is not empty');
  });

  it.each([
    ['без аргументов', []],
    ['неизвестный флаг', ['x', '--nope']],
    ['--id без значения', ['x', '--id']],
    ['лишний аргумент', ['a', 'b']],
  ])('%s — код 2 и справка', async (_name, argv) => {
    const cwd = await makeTemp();
    const { code, stdout, stderr } = await run(argv, cwd);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('usage: create-spirula-extension');
  });

  it('id нельзя вывести из имени каталога — код 2 с просьбой указать --id', async () => {
    const cwd = await makeTemp();
    const { code, stderr } = await run(['2024'], cwd);
    expect(code).toBe(2);
    expect(stderr).toContain('--id');
  });

  it('явный --id спасает такой каталог', async () => {
    const cwd = await makeTemp();
    const { code } = await run(['2024', '--id', 'acme.hello'], cwd);
    expect(code).toBe(0);
  });

  it('--help — код 0, справка в stdout', async () => {
    const cwd = await makeTemp();
    const { code, stdout } = await run(['--help'], cwd);
    expect(code).toBe(0);
    expect(stdout).toContain('usage: create-spirula-extension');
  });
});
