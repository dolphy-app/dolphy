import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli/run.ts';
import { CatalogUsageError } from '../src/errors.ts';
import { QUICK_EXIT_HINT, findApp } from '../src/dev.ts';
import type { AppExit, AppLocation, DevDeps } from '../src/dev.ts';
import { copyProject, waitFor } from './helpers.ts';

const where = (
  platform: string,
  present: string[],
  extra: Partial<AppLocation> = {},
): AppLocation => ({
  platform,
  env: {},
  home: platform === 'win32' ? 'C:\\Users\\ann' : '/home/ann',
  exists: (file) => present.includes(file),
  list: () => [],
  ...extra,
});

describe('findApp', () => {
  it('macOS: /Applications first, then ~/Applications; the bundle is started by its executable', () => {
    const both = [
      '/Applications/Dolphy.app',
      '/home/ann/Applications/Dolphy.app',
    ];
    expect(findApp(undefined, where('darwin', both))).toBe(
      '/Applications/Dolphy.app/Contents/MacOS/Dolphy',
    );
    expect(findApp(undefined, where('darwin', both.slice(1)))).toBe(
      '/home/ann/Applications/Dolphy.app/Contents/MacOS/Dolphy',
    );
  });

  it('Windows: %LOCALAPPDATA%\\Programs\\Dolphy\\Dolphy.exe, by default under the home directory', () => {
    const exe = 'C:\\Users\\ann\\AppData\\Local\\Programs\\Dolphy\\Dolphy.exe';
    expect(findApp(undefined, where('win32', [exe]))).toBe(exe);
    const custom = 'D:\\Local\\Programs\\Dolphy\\Dolphy.exe';
    expect(
      findApp(
        undefined,
        where('win32', [custom], { env: { LOCALAPPDATA: 'D:\\Local' } }),
      ),
    ).toBe(custom);
  });

  it('Linux: the newest AppImage by version, not by name order', () => {
    const names = [
      'Dolphy-Linux-1.9.0.AppImage',
      'Dolphy-Linux-1.12.0.AppImage',
      'Dolphy-Linux-1.10.3.AppImage',
      'Dolphy-Linux-1.12.0.AppImage.zsync',
      'notes.txt',
    ];
    const present = names.map((name) => `/home/ann/Applications/${name}`);
    expect(
      findApp(undefined, where('linux', present, { list: () => names })),
    ).toBe('/home/ann/Applications/Dolphy-Linux-1.12.0.AppImage');
  });

  it('--app wins over DOLPHY_APP, which wins over the standard places', () => {
    const present = ['/Applications/Dolphy.app', '/x/dolphy', '/y/dolphy'];
    const env = { DOLPHY_APP: '/y/dolphy' };
    expect(findApp('/x/dolphy', where('darwin', present, { env }))).toBe(
      '/x/dolphy',
    );
    expect(findApp(undefined, where('darwin', present, { env }))).toBe(
      '/y/dolphy',
    );
  });

  it('nothing found: code-2 error that names the places and the ways to point to the app', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const error = (() => {
        try {
          return findApp(undefined, where(platform, []));
        } catch (caught) {
          return caught;
        }
      })();
      expect(error).toBeInstanceOf(CatalogUsageError);
      const { message } = error as Error;
      expect(message).toContain('not found');
      expect(message).toContain(
        platform === 'darwin' ? '/Applications/Dolphy.app' : 'Dolphy',
      );
      expect(message).toContain('--app');
      expect(message).toContain('DOLPHY_APP');
    }
  });

  it('a given path that does not exist is an error naming its source, not a silent fallback', () => {
    const present = ['/Applications/Dolphy.app'];
    expect(() => findApp('/nope', where('darwin', present))).toThrow(
      "--app points to '/nope'",
    );
    expect(() =>
      findApp(
        undefined,
        where('darwin', present, { env: { DOLPHY_APP: '/nope' } }),
      ),
    ).toThrow("DOLPHY_APP points to '/nope'");
  });
});

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

/** An exit signal that never comes. */
const never = new Promise<void>(() => {});

/** A fake app: records how it was launched and ends when the test says so. */
const fakeApp = (options: { clock?: () => number } = {}) => {
  const launches: {
    command: string;
    env: Readonly<Record<string, string | undefined>>;
    builtAtLaunch: boolean;
  }[] = [];
  let quit: (exit: AppExit) => void = () => undefined;
  let killed = 0;
  const deps = (root: string): DevDeps => ({
    ...where('linux', ['/opt/dolphy'], {
      env: { DOLPHY_APP: '/opt/dolphy', PATH: '/bin' },
    }),
    launch: (command, env) => {
      const exited = new Promise<AppExit>((resolve) => {
        quit = resolve;
      });
      launches.push({
        command,
        env,
        // the app reads its directory at start: the first build must be there already
        builtAtLaunch: existsSync(
          path.join(root, 'dist-ext', 'acme.hello', 'main.mjs'),
        ),
      });
      return {
        exited,
        kill: () => {
          killed += 1;
          quit({ code: null, signal: 'SIGTERM' });
        },
      };
    },
    now: options.clock ?? Date.now,
  });
  return {
    launches,
    deps,
    quit: (exit: AppExit) => quit(exit),
    killed: () => killed,
  };
};

describe('dolphy-ext dev', () => {
  it('builds in watch mode, launches the app with DOLPHY_DEV_EXTENSIONS and stops both on the exit signal with code 0', async () => {
    const root = await copyProject('hello');
    const app = fakeApp();
    const cli = createIo();
    let stop: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => {
      stop = resolve;
    });
    const running = runCli(['dev', root], cli.io, {
      env: { PATH: '/bin' },
      dev: app.deps(root),
      waitForExit: () => stopped,
    });
    await waitFor(async () => app.launches.length > 0);
    await waitFor(async () => cli.stdout().includes('watching'));
    const [launch] = app.launches;
    expect(launch?.command).toBe('/opt/dolphy');
    expect(launch?.env.DOLPHY_DEV_EXTENSIONS).toBe(path.join(root, 'dist-ext'));
    expect(launch?.env.PATH).toBe('/bin');
    expect(launch?.builtAtLaunch).toBe(true);
    expect(cli.stdout()).toContain('/opt/dolphy');
    expect(
      (await stat(path.join(root, 'dist-ext', 'acme.hello', 'main.mjs'))).size,
    ).toBeGreaterThan(0);
    stop();
    expect(await running).toBe(0);
    expect(app.killed()).toBe(1);
    expect(cli.stderr()).toBe('');
  });

  it('an app that quits at once: hint about a running instance and code 1; a later quit is a normal end', async () => {
    const root = await copyProject('hello');
    let now = 1000;
    const quick = fakeApp({ clock: () => now });
    const first = createIo();
    const running = runCli(['dev', root], first.io, {
      dev: quick.deps(root),
      waitForExit: () => never,
    });
    await waitFor(async () => quick.launches.length > 0);
    now += 400;
    quick.quit({ code: 0, signal: null });
    expect(await running).toBe(1);
    expect(first.stderr()).toContain(QUICK_EXIT_HINT);
    expect(QUICK_EXIT_HINT).toContain(
      'Dolphy is probably already running: quit it and run again',
    );

    const later = fakeApp({ clock: () => now });
    const second = createIo();
    const again = runCli(['dev', root], second.io, {
      dev: later.deps(root),
      waitForExit: () => never,
    });
    await waitFor(async () => later.launches.length > 0);
    now += 60_000;
    later.quit({ code: 0, signal: null });
    expect(await again).toBe(0);
    expect(second.stderr()).toBe('');
  });

  it('an app ended by a signal (Ctrl+C reached the whole process group) is a stop, not a failed start', async () => {
    const root = await copyProject('hello');
    const app = fakeApp();
    const cli = createIo();
    const running = runCli(['dev', root], cli.io, {
      dev: app.deps(root),
      waitForExit: () => never,
    });
    await waitFor(async () => app.launches.length > 0);
    app.quit({ code: null, signal: 'SIGINT' });
    expect(await running).toBe(0);
    expect(cli.stderr()).toBe('');
  });

  it('no app: code 2, the places in the message, and nothing is built', async () => {
    const root = await copyProject('hello');
    const cli = createIo();
    const code = await runCli(['dev', root], cli.io, {
      dev: {
        ...where('darwin', []),
        launch: () => {
          throw new Error('must not launch');
        },
        now: Date.now,
      },
    });
    expect(code).toBe(2);
    expect(cli.stderr()).toMatch(
      /^error dolphy-ext dev: the Dolphy app is not found; looked at: \/Applications\/Dolphy\.app, \/home\/ann\/Applications\/Dolphy\.app;/,
    );
    expect(cli.stderr()).toContain('--app <path>');
    await expect(stat(path.join(root, 'dist-ext'))).rejects.toThrow();
  });

  it('a project that does not build: code 1, the app is not started', async () => {
    const root = await copyProject('bad-manifest');
    const app = fakeApp();
    const cli = createIo();
    expect(await runCli(['dev', root], cli.io, { dev: app.deps(root) })).toBe(
      1,
    );
    expect(app.launches).toEqual([]);
    expect(cli.stderr()).toMatch(/^error .+: .*invalid extension id/);
  });

  it('usage: --app needs a path, unknown flags and extra arguments are code 2', async () => {
    for (const argv of [
      ['dev', '--app'],
      ['dev', '--nope'],
      ['dev', 'a', 'b'],
    ]) {
      const cli = createIo();
      expect(await runCli(argv, cli.io)).toBe(2);
      expect(cli.stderr()).toContain('usage: dolphy-ext');
    }
  });
});
