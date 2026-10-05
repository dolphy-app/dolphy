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

  it('T-32 validate: ok and problems', async () => {
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

  it('validate: an unknown permission — an error with the field path, a known one passes', async () => {
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

  it('validate: importers and exporters pass; a progress exporter needs learning.stats; an upper-case accept is refused', async () => {
    const root = await copyProject('typed-transfers');
    const built = createIo();
    expect(await runCli(['build', root], built.io), built.stderr()).toBe(0);
    const dir = path.join(root, 'dist-ext', 'acme.transfer');
    const manifestPath = path.join(dir, 'extension.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      contributes: { importers: { accept: string[] }[] };
    };

    const ok = createIo();
    expect(await runCli(['validate', dir], ok.io)).toBe(0);

    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, permissions: [] }),
    );
    const noStats = createIo();
    expect(await runCli(['validate', dir], noStats.io)).toBe(1);
    expect(noStats.stderr()).toMatch(/exporters\.1\.scope: .*learning\.stats/);

    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        contributes: {
          ...manifest.contributes,
          importers: [
            { ...manifest.contributes.importers[0], accept: ['.CSV'] },
          ],
        },
      }),
    );
    const upper = createIo();
    expect(await runCli(['validate', dir], upper.io)).toBe(1);
    expect(upper.stderr()).toMatch(/importers\.0\.accept\.0: /);
  });

  it('validate: `when` of a command, a panel and a widget is checked with the position of the problem', async () => {
    const root = await copyProject('commands-panel');
    const built = createIo();
    expect(await runCli(['build', root], built.io), built.stderr()).toBe(0);
    const dir = path.join(root, 'dist-ext', 'acme.commands-panel');
    const manifestPath = path.join(dir, 'extension.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      contributes: {
        commands: object[];
        panels: object[];
        widgets?: object[];
      };
    };
    const withWhen = async (when: string) => {
      const { commands, panels } = manifest.contributes;
      await writeFile(
        manifestPath,
        JSON.stringify({
          ...manifest,
          contributes: {
            commands: [{ ...commands[0], when }, commands[1]],
            panels: [{ ...panels[0], when }],
            widgets: [
              {
                id: 'acme.commands-panel.card',
                title: 'Card',
                slot: 'dailyPlan',
                module: './panel.mjs',
                when,
              },
            ],
          },
        }),
      );
      const cli = createIo();
      return { code: await runCli(['validate', dir], cli.io), cli };
    };

    const ok = await withWhen("route == 'courses' && !(session.active)");
    expect(ok.code, ok.cli.stderr()).toBe(0);

    const bad = await withWhen("route == 'home'");
    expect(bad.code).toBe(1);
    for (const where of ['commands', 'panels', 'widgets']) {
      expect(bad.cli.stderr()).toContain(
        `contributes.${where}.0.when: invalid "when" (unknown value 'home' for 'route'`,
      );
    }
    expect(bad.cli.stderr()).toContain(') at 9)');
  });

  it('metadata and compatibility: build copies the manifest as is, validate checks the shape', async () => {
    const root = await copyProject('with-metadata');
    const built = createIo();
    expect(await runCli(['build', root], built.io)).toBe(0);
    const dir = path.join(root, 'dist-ext', 'acme.meta');
    expect(await readFile(path.join(dir, 'extension.json'), 'utf8')).toBe(
      await readFile(path.join(root, 'extension.json'), 'utf8'),
    );
    const good = createIo();
    expect(await runCli(['validate', dir], good.io)).toBe(0);

    const manifestPath = path.join(dir, 'extension.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as object;
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, minAppVersion: '1.0', platforms: ['bsd'] }),
    );
    const bad = createIo();
    expect(await runCli(['validate', dir], bad.io)).toBe(1);
    expect(bad.stderr()).toMatch(/minAppVersion/);
    expect(bad.stderr()).toMatch(/platforms\.0/);
  });

  it('types: writes .dolphy/ids.d.ts without building, then reports it is up to date', async () => {
    const root = await copyProject('commands-panel');
    const file = path.join(root, '.dolphy', 'ids.d.ts');

    const first = createIo();
    expect(await runCli(['types', root], first.io)).toBe(0);
    expect(first.stdout()).toBe('wrote .dolphy/ids.d.ts\n');
    const text = await readFile(file, 'utf8');
    expect(text).toContain(
      "commands: 'acme.commands-panel.open' | 'acme.commands-panel.ping'",
    );
    expect(text).toContain("panels: 'acme.commands-panel.main'");
    await expect(readFile(path.join(root, 'dist-ext'))).rejects.toThrow();

    const second = createIo();
    expect(await runCli(['types', root], second.io)).toBe(0);
    expect(second.stdout()).toBe('.dolphy/ids.d.ts is up to date\n');
    expect(second.stderr()).toBe('');
  });

  it('types of a broken manifest: code 1 and the problem in stderr, no file', async () => {
    const root = await copyProject('bad-manifest');
    const cli = createIo();
    expect(await runCli(['types', root], cli.io)).toBe(1);
    expect(cli.stderr()).toMatch(/^error .+: .*invalid extension id/);
    await expect(
      readFile(path.join(root, '.dolphy', 'ids.d.ts')),
    ).rejects.toThrow();
  });

  it.each([
    [[]],
    [['publish']],
    [['build', '--nope']],
    [['build', 'a', 'b']],
    [['build', '--out']],
    [['validate']],
    [['types', '--nope']],
    [['types', 'a', 'b']],
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
