import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli/run.ts';
import { copyProject, waitFor } from './helpers.ts';

const createIo = () => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (text: string) => out.push(text),
      stderr: (text: string) => err.push(text),
    },
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
};

describe('runCli', () => {
  it('T-30 build: код 0 и сводка в stdout', async () => {
    const root = await copyProject('hello');
    const out = path.join(root, 'out');
    const cli = createIo();
    const code = await runCli(['build', root, '--out', out], cli.io);
    expect(code).toBe(0);
    expect(cli.stdout()).toBe(
      `built acme.hello -> ${path.join(out, 'acme.hello')} (3 files)\n`,
    );
    expect(cli.stderr()).toBe('');
  });

  it('T-31 build сломанного проекта: код 1, проблема в stderr', async () => {
    const root = await copyProject('bad-manifest');
    const cli = createIo();
    expect(await runCli(['build', root], cli.io)).toBe(1);
    expect(cli.stdout()).toBe('');
    expect(cli.stderr()).toMatch(/^error .+: .*invalid extension id/);
  });

  it('T-32 validate: ok и проблемы', async () => {
    const root = await copyProject('hello');
    const built = createIo();
    await runCli(['build', root], built.io);
    const dir = path.join(root, 'dist-ext', 'acme.hello');

    const good = createIo();
    expect(await runCli(['validate', dir], good.io)).toBe(0);
    expect(good.stdout()).toBe(`${dir}: ok\n`);

    const bad = createIo();
    expect(await runCli(['validate', root], bad.io)).toBe(1);
    expect(bad.stderr()).toContain(`error ${root}: `);
  });

  it('validate: неизвестное разрешение — ошибка с путём поля, известное проходит', async () => {
    const root = await copyProject('hello');
    const built = createIo();
    await runCli(['build', root], built.io);
    const dir = path.join(root, 'dist-ext', 'acme.hello');
    const manifestPath = path.join(dir, 'extension.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as object;

    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, permissions: ['network'] }),
    );
    const ok = createIo();
    expect(await runCli(['validate', dir], ok.io)).toBe(0);

    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, permissions: ['disk.write'] }),
    );
    const bad = createIo();
    expect(await runCli(['validate', dir], bad.io)).toBe(1);
    expect(bad.stderr()).toMatch(/permissions\.0: /);
  });

  it.each([
    [[]],
    [['publish']],
    [['build', '--nope']],
    [['build', 'a', 'b']],
    [['build', '--out']],
    [['validate']],
  ])('T-33 неверные аргументы %j — код 2', async (argv) => {
    const cli = createIo();
    expect(await runCli(argv, cli.io)).toBe(2);
    expect(cli.stderr()).toContain('usage: spirula-ext');
  });

  it('T-34 --help: код 0, справка в stdout', async () => {
    const cli = createIo();
    expect(await runCli(['--help'], cli.io)).toBe(0);
    expect(cli.stdout()).toContain('usage: spirula-ext');
  });

  it('T-35 build --watch работает до сигнала выхода', async () => {
    const root = await copyProject('hello');
    const out = path.join(root, 'out');
    const cli = createIo();
    let exit: () => void = () => {};
    const exited = new Promise<void>((resolve) => {
      exit = resolve;
    });
    const running = runCli(['build', root, '--out', out, '--watch'], cli.io, {
      waitForExit: () => exited,
    });
    await waitFor(async () => cli.stdout().includes('watching'));
    const main = path.join(out, 'acme.hello', 'main.mjs');
    expect((await readFile(main, 'utf8')).length).toBeGreaterThan(0);
    exit();
    expect(await running).toBe(0);
  });
});
