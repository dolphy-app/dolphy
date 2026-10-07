import { readFile, rm, writeFile } from 'node:fs/promises';
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

const readManifest = async (file: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;

describe('runCli', () => {
  it('T-30 build: code 0 and a summary in stdout', async () => {
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

  it('T-31 build of a broken project: code 1, problem in stderr', async () => {
    const root = await copyProject('bad-manifest');
    const cli = createIo();
    expect(await runCli(['build', root], cli.io)).toBe(1);
    expect(cli.stdout()).toBe('');
    expect(cli.stderr()).toMatch(/^error .+: .*invalid extension id/);
  });

  it('build of a project without src/index.ts: code 1, the missing entry in stderr', async () => {
    const root = await copyProject('no-entry');
    const cli = createIo();
    expect(await runCli(['build', root], cli.io)).toBe(1);
    expect(cli.stderr()).toContain("'src/index.ts' is not found");
  });

  it('T-32 validate: ok and problems', async () => {
    const root = await copyProject('hello');
    const built = createIo();
    await runCli(['build', root], built.io);
    const dir = path.join(root, 'dist-ext', 'acme.hello');

    const good = createIo();
    expect(await runCli(['validate', dir], good.io)).toBe(0);
    expect(good.stdout()).toBe(`${dir}: ok\n`);

    // манифест с ключом `contributes` валидатор отклоняет
    await writeFile(
      path.join(dir, 'extension.json'),
      JSON.stringify({
        ...JSON.parse(await readFile(path.join(dir, 'extension.json'), 'utf8')),
        contributes: {},
      }),
    );
    const bad = createIo();
    expect(await runCli(['validate', dir], bad.io)).toBe(1);
    expect(bad.stderr()).toContain(`error ${dir}: `);
  });

  it('validate: a built extension without its declared client file is refused', async () => {
    const root = await copyProject('hello');
    const built = createIo();
    expect(await runCli(['build', root], built.io), built.stderr()).toBe(0);
    const dir = path.join(root, 'dist-ext', 'acme.hello');
    await rm(path.join(dir, 'client.mjs'));

    const cli = createIo();
    expect(await runCli(['validate', dir], cli.io)).toBe(1);
    expect(cli.stderr()).toContain('client.mjs');
  });

  it('validate: dependencies with a range pass; itself, a repeat and a bad range are refused with the field path', async () => {
    const root = await copyProject('hello');
    const built = createIo();
    expect(await runCli(['build', root], built.io), built.stderr()).toBe(0);
    const dir = path.join(root, 'dist-ext', 'acme.hello');
    const manifestPath = path.join(dir, 'extension.json');
    const manifest = await readManifest(manifestPath);
    const run = async (dependencies: unknown[]) => {
      await writeFile(
        manifestPath,
        JSON.stringify({ ...manifest, dependencies }),
      );
      const io = createIo();
      return { code: await runCli(['validate', dir], io.io), err: io.stderr() };
    };

    expect(
      (await run([{ id: 'acme.base', range: '>=1.0.0 <2.0.0' }])).code,
    ).toBe(0);
    const self = await run([{ id: 'acme.hello' }]);
    expect(self.code).toBe(1);
    expect(self.err).toMatch(/dependencies\.0\.id: .*itself/);
    const repeat = await run([{ id: 'acme.a' }, { id: 'acme.a' }]);
    expect(repeat.err).toMatch(/dependencies\.1\.id: duplicate/);
    const range = await run([{ id: 'acme.a', range: 'newer' }]);
    expect(range.err).toMatch(/dependencies\.0\.range: /);
  });

  it('metadata and compatibility: build keeps the metadata and sets main and client, validate checks the shape', async () => {
    const root = await copyProject('with-metadata');
    const built = createIo();
    expect(await runCli(['build', root], built.io)).toBe(0);
    const dir = path.join(root, 'dist-ext', 'acme.meta');
    const manifestPath = path.join(dir, 'extension.json');
    const manifest = await readManifest(manifestPath);
    expect(manifest).toMatchObject({
      id: 'acme.meta',
      name: 'Meta',
      description: 'Extension with metadata',
      author: 'octo-cat',
      platforms: ['darwin', 'linux', 'win32'],
      minAppVersion: '1.0.0',
      main: null,
      client: './client.mjs',
    });
    const good = createIo();
    expect(await runCli(['validate', dir], good.io)).toBe(0);

    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, minAppVersion: '1.0', platforms: ['bsd'] }),
    );
    const bad = createIo();
    expect(await runCli(['validate', dir], bad.io)).toBe(1);
    expect(bad.stderr()).toMatch(/minAppVersion/);
    expect(bad.stderr()).toMatch(/platforms\.0/);
  });

  it('the types command is not known: code 2 and the usage', async () => {
    const cli = createIo();
    expect(await runCli(['types', '.'], cli.io)).toBe(2);
    expect(cli.stderr()).toContain('usage: dolphy-ext');
  });

  it.each([
    [[]],
    [['publish']],
    [['build', '--nope']],
    [['build', 'a', 'b']],
    [['build', '--out']],
    [['validate']],
  ])('T-33 invalid arguments %j — code 2', async (argv) => {
    const cli = createIo();
    expect(await runCli(argv, cli.io)).toBe(2);
    expect(cli.stderr()).toContain('usage: dolphy-ext');
  });

  it('T-34 --help: code 0, help in stdout', async () => {
    const cli = createIo();
    expect(await runCli(['--help'], cli.io)).toBe(0);
    expect(cli.stdout()).toContain('usage: dolphy-ext');
  });

  it('T-35 build --watch runs until the exit signal', async () => {
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
