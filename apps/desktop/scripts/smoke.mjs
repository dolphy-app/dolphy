// Сквозной смоук в настоящем Electron.
//   pnpm smoke           смоук-сборка (LMS_SMOKE_BUILD=1 → dist-smoke) и запуск
//                        неупакованного приложения
//   pnpm smoke:packaged  та же сборка, упакованная в неподписанный .app
//                        (electron-builder --dir, вывод во временный каталог) и
//                        запуск его бинарника: хост и раннер из app.asar,
//                        better-sqlite3 из app.asar.unpacked
// Смоук-код есть только в смоук-сборке; релизная сборка его не содержит
// (test/release-bundle.test.ts). Режим включает LMS_SMOKE=1 в окружении.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RESULT_PREFIX = 'LMS_SMOKE_RESULT ';
const TIMEOUT_MS = 120_000;
const ORPHAN_WAIT_MS = 5_000;
const SMOKE_DIR = 'dist-smoke';
const SCENARIOS = ['basic', 'sql', 'crash'];

const root = await mkdtemp(join(tmpdir(), 'lms-smoke-'));
const appDir = fileURLToPath(new URL('..', import.meta.url));
const libraryFixture = fileURLToPath(
  new URL(
    '../../../packages/engine/test/fixtures/libraries/sql-course/lib_kb',
    import.meta.url,
  ),
);
const verbose = process.argv.includes('--verbose');
const packaged = process.argv.includes('--packaged');
const shell = process.platform === 'win32';

const fail = (message) => {
  rmSync(root, { recursive: true, force: true });
  console.error(`smoke: ${message}`);
  process.exit(1);
};

const run = (command, args, env) => {
  const result = spawnSync(command, args, {
    cwd: appDir,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    shell,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (verbose || result.status !== 0) {
    process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed (${result.status})`);
  }
};

const userData = join(root, 'userData');
const library = join(root, 'library');
const packagedOut = join(root, 'app');
let marker = join(appDir, SMOKE_DIR, 'dist-electron'); // для поиска осиротевших процессов

const cleanup = () => rm(root, { recursive: true, force: true });

const listProcesses = () => {
  if (shell) return [];
  const { stdout } = spawnSync('ps', ['-axo', 'pid=,command='], {
    encoding: 'utf8',
  });
  return stdout
    .split('\n')
    .filter((line) => line.includes(marker))
    .map((line) => line.trim())
    .filter((line) => Number(line.split(/\s+/)[0]) !== process.pid);
};

// 1. смоук-сборка: renderer, main, preload, host и sql-worker с кодом смоука
run('pnpm', ['exec', 'vite', 'build'], { LMS_SMOKE_BUILD: '1' });

// 2. упаковка (только --packaged): без подписи, во временный каталог
let command = createRequire(import.meta.url)('electron');
let args = [join(SMOKE_DIR, 'dist-electron/main/index.js')];
if (packaged) {
  const base = JSON.parse(readFileSync(join(appDir, 'electron-builder.json')));
  delete base.$schema;
  const config = {
    ...base,
    directories: { ...base.directories, output: packagedOut },
    files: [SMOKE_DIR, '!**/node_modules/better-sqlite3/{deps,src}/**'],
    extraMetadata: { main: `${SMOKE_DIR}/dist-electron/main/index.js` },
  };
  const configPath = join(root, 'electron-builder.smoke.json');
  await writeFile(configPath, JSON.stringify(config));
  run(
    'pnpm',
    [
      'exec',
      'electron-builder',
      '--dir',
      '--publish',
      'never',
      '-c',
      configPath,
    ],
    { CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  );
  const unpackedDir = readdirSync(packagedOut).find((name) =>
    /^(mac|linux-unpacked|win-unpacked)/.test(name),
  );
  if (!unpackedDir) fail(`no unpacked app in ${packagedOut}`);
  const unpacked = join(packagedOut, unpackedDir);
  let resourcesDir;
  if (process.platform === 'darwin') {
    command = join(unpacked, 'LMS.app/Contents/MacOS/LMS');
    resourcesDir = join(unpacked, 'LMS.app/Contents/Resources');
  } else {
    const names =
      process.platform === 'win32' ? ['LMS.exe'] : ['LMS', 'lms', 'desktop'];
    const found = names.find((name) => existsSync(join(unpacked, name)));
    if (!found) fail(`no executable in ${unpacked}`);
    command = join(unpacked, found);
    resourcesDir = join(unpacked, 'resources');
  }
  args = [];
  marker = join(basename(root), 'app'); // /var → /private/var: путь целиком не годится
  const native = join(
    resourcesDir,
    'app.asar.unpacked/node_modules/better-sqlite3/prebuilds',
  );
  if (!existsSync(join(resourcesDir, 'app.asar')) || !existsSync(native)) {
    fail(
      `app.asar or app.asar.unpacked (better-sqlite3) missing in ${resourcesDir}`,
    );
  }
  console.log(`packaged app: ${command}`);
}

// 3. запуск: временный userData, копия библиотеки sql-course
await mkdir(userData, { recursive: true });
await cp(libraryFixture, library, { recursive: true });
const lines = { stdout: [], stderr: [] };
const child = spawn(command, args, {
  cwd: appDir,
  env: {
    ...process.env,
    LMS_SMOKE: '1',
    LMS_SMOKE_USER_DATA: userData,
    LMS_SMOKE_LIBRARY: library,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const collect = (stream, name) => {
  let rest = '';
  stream.on('data', (chunk) => {
    const parts = (rest + chunk).split('\n');
    rest = parts.pop();
    for (const line of parts) {
      lines[name].push(line);
      if (verbose && name === 'stderr') console.error(line);
    }
  });
};
collect(child.stdout, 'stdout');
collect(child.stderr, 'stderr');
const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
const code = await new Promise((resolve) => {
  child.on('exit', resolve);
});
clearTimeout(timer);

// 4. осиротевшие процессы (раннер SQL, хост, helper'ы)
const deadline = Date.now() + ORPHAN_WAIT_MS;
let orphans = listProcesses();
while (orphans.length > 0 && Date.now() < deadline) {
  await sleep(200);
  orphans = listProcesses();
}
for (const entry of orphans) {
  process.kill(Number(entry.split(/\s+/)[0]), 'SIGKILL');
}
await cleanup();

// 5. итог
const line = lines.stdout.find((entry) => entry.startsWith(RESULT_PREFIX));
if (!line) {
  console.error(lines.stderr.slice(-30).join('\n'));
  fail(`no result, electron exit code ${code}`);
}
const payload = JSON.parse(line.slice(RESULT_PREFIX.length));
const { versions, result } = payload;
console.log(
  `electron ${versions.electron}, node ${versions.node}, chrome ${versions.chrome}, packaged ${payload.packaged}`,
);
for (const name of SCENARIOS) {
  const scenario = result.scenarios?.[name];
  console.log(`${scenario?.ok ? 'PASS' : 'FAIL'} ${name}`);
  console.log(JSON.stringify(scenario ?? null));
}
if (result.error) console.log(`error: ${result.error}`);
for (const entry of lines.stderr) {
  if (entry.includes('sql runner started') || entry.includes('engine host')) {
    console.log(entry);
  }
}
const problems = [];
if (!result.ok || code !== 0) problems.push(`exit ${code}`);
if (payload.packaged !== packaged) {
  problems.push(`packaged is ${payload.packaged}, expected ${packaged}`);
}
if (orphans.length > 0) {
  problems.push(`orphan processes killed: ${orphans.join(' | ')}`);
}
if (problems.length > 0) console.error(lines.stderr.slice(-30).join('\n'));
console.log(
  `smoke${packaged ? ' (packaged)' : ''} ${problems.length === 0 ? 'passed' : `FAILED: ${problems.join('; ')}`}`,
);
process.exit(problems.length === 0 ? 0 : 1);
