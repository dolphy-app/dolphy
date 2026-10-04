import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { CatalogUsageError } from './errors.ts';

/** An app that quits sooner than this did not start for us: see `QUICK_EXIT_HINT`. */
export const QUICK_EXIT_MS = 5000;

export const QUICK_EXIT_HINT =
  'Dolphy is probably already running: quit it and run again (the app has a single instance, a second launch exits at once and the extension directory is lost)';

export interface AppExit {
  /** `null` when the process was ended by a signal. */
  code: number | null;
  signal: string | null;
}

export interface AppProcess {
  /** Rejects when the process cannot be started. */
  exited: Promise<AppExit>;
  kill(): void;
}

export interface AppLocation {
  /** Platform name as in `process.platform`. */
  platform: string;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  exists(file: string): boolean;
  /** File names in a directory; empty when it is missing. */
  list(dir: string): string[];
}

export interface DevDeps extends AppLocation {
  launch(
    command: string,
    env: Readonly<Record<string, string | undefined>>,
  ): AppProcess;
  now(): number;
}

export interface DevIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const flavor = (platform: string): typeof path.posix =>
  platform === 'win32' ? path.win32 : path.posix;

/** `Dolphy-Linux-1.12.0.AppImage` → `[1, 12, 0]`; other names have no version. */
const versionOf = (name: string): number[] | null => {
  const match = /^Dolphy-Linux-(\d+(?:\.\d+)*)\.AppImage$/.exec(name);
  return match === null ? null : (match[1] as string).split('.').map(Number);
};

const compareVersions = (a: number[], b: number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/** Places the installer puts the app (`electron-builder.json`); Linux has no fixed place. */
const standardPlaces = (where: AppLocation): string[] => {
  const p = flavor(where.platform);
  if (where.platform === 'darwin') {
    return [
      '/Applications/Dolphy.app',
      p.join(where.home, 'Applications', 'Dolphy.app'),
    ];
  }
  if (where.platform === 'win32') {
    const base =
      where.env.LOCALAPPDATA ?? p.join(where.home, 'AppData', 'Local');
    return [p.join(base, 'Programs', 'Dolphy', 'Dolphy.exe')];
  }
  const dir = p.join(where.home, 'Applications');
  return where
    .list(dir)
    .flatMap((name) => {
      const version = versionOf(name);
      return version === null ? [] : [{ name, version }];
    })
    .sort((a, b) => compareVersions(b.version, a.version))
    .map(({ name }) => p.join(dir, name));
};

const lookedAt = (where: AppLocation): string =>
  where.platform === 'linux'
    ? flavor(where.platform).join(
        where.home,
        'Applications',
        'Dolphy-Linux-*.AppImage',
      )
    : standardPlaces(where).join(', ');

const missing = (where: AppLocation, what: string): CatalogUsageError =>
  new CatalogUsageError(
    `${what}; looked at: ${lookedAt(where)}; point to the app with --app <path> or the DOLPHY_APP environment variable`,
    'dolphy-ext dev',
  );

/**
 * The app to launch: `--app`, then `DOLPHY_APP`, then the standard places of the
 * platform. A macOS bundle (`Dolphy.app`) is started by its executable, so that
 * the environment reaches the app and the process lives as long as the app does.
 */
export const findApp = (
  explicit: string | undefined,
  where: AppLocation,
): string => {
  const p = flavor(where.platform);
  const given = explicit ?? where.env.DOLPHY_APP;
  const chosen = given === undefined || given === '' ? null : given;
  const found =
    chosen !== null
      ? where.exists(chosen)
        ? chosen
        : null
      : (standardPlaces(where).find((place) => where.exists(place)) ?? null);
  if (found === null) {
    throw missing(
      where,
      chosen === null
        ? 'the Dolphy app is not found'
        : `${explicit === undefined ? 'DOLPHY_APP' : '--app'} points to '${chosen}', which does not exist`,
    );
  }
  return found.endsWith('.app')
    ? p.join(found, 'Contents', 'MacOS', p.basename(found, '.app'))
    : found;
};

export const systemDeps = (
  env: Readonly<Record<string, string | undefined>>,
): DevDeps => ({
  platform: process.platform,
  env,
  home: homedir(),
  exists: existsSync,
  list: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
  launch: (command, childEnv) => {
    const child = spawn(command, [], {
      env: childEnv as NodeJS.ProcessEnv,
      stdio: 'inherit',
    });
    return {
      exited: new Promise<AppExit>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
      }),
      kill: () => {
        child.kill('SIGTERM');
      },
    };
  },
  now: Date.now,
});

export interface DevOptions {
  root: string;
  app?: string;
}

/** What ended the session. */
type Ending = { by: 'user' } | { by: 'app'; exit: AppExit };

/** Everything `runDev` needs from the build side: `watchExtension` in production. */
export interface DevBuild {
  /** Directory the build writes to (`DOLPHY_DEV_EXTENSIONS`). */
  outDir: string;
  summary: string;
  close(): Promise<void>;
}

/**
 * `dolphy-ext dev`: a watch build of the project and the installed app that
 * reads the output through `DOLPHY_DEV_EXTENSIONS`. Resolves with the exit code
 * when the user stops it (0) or the app quits (0 after a normal session, 1 when
 * it quit at once).
 */
export const runDev = async (
  options: DevOptions,
  io: DevIo,
  deps: DevDeps,
  startBuild: () => Promise<DevBuild>,
  waitForExit: () => Promise<void>,
): Promise<number> => {
  const command = findApp(options.app, deps);
  const build = await startBuild();
  io.stdout(`${build.summary}\n`);
  let app: AppProcess | null = null;
  try {
    io.stdout(
      `launching ${command} with DOLPHY_DEV_EXTENSIONS=${build.outDir}\n`,
    );
    const startedAt = deps.now();
    app = deps.launch(command, {
      ...deps.env,
      DOLPHY_DEV_EXTENSIONS: build.outDir,
    });
    io.stdout('watching for changes, Ctrl+C stops the build and the app\n');
    const ending = await Promise.race<Ending>([
      waitForExit().then(() => ({ by: 'user' as const })),
      app.exited.then((exit) => ({ by: 'app' as const, exit })),
    ]);
    if (ending.by === 'user') {
      app.kill();
      await app.exited.catch(() => undefined);
      return 0;
    }
    // Ctrl+C reaches the whole process group: an app ended by a signal is a stop, not a failed start
    const { code } = ending.exit;
    if (code !== null && deps.now() - startedAt < QUICK_EXIT_MS) {
      io.stderr(`${QUICK_EXIT_HINT}\n`);
      return 1;
    }
    return 0;
  } catch (error) {
    io.stderr(
      `error dolphy-ext dev: cannot run ${command}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    await build.close();
  }
};
