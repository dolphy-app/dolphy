// Сквозной смоук в настоящем Electron: `pnpm smoke` (после `vite build`).
// Только для проверки: LMS_SMOKE=1 работает в неупакованном приложении и
// поднимает движок на временном userData с копией библиотеки sql-course.
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RESULT_PREFIX = 'LMS_SMOKE_RESULT ';
const TIMEOUT_MS = 120_000;

const appDir = fileURLToPath(new URL('..', import.meta.url));
const libraryFixture = fileURLToPath(
  new URL(
    '../../../packages/engine/test/fixtures/libraries/sql-course/lib_kb',
    import.meta.url,
  ),
);
const electronPath = createRequire(import.meta.url)('electron');

const root = await mkdtemp(join(tmpdir(), 'lms-smoke-'));
const userData = join(root, 'userData');
const library = join(root, 'library');
await mkdir(userData, { recursive: true });
await cp(libraryFixture, library, { recursive: true });

const verbose = process.argv.includes('--verbose');
const lines = { stdout: [], stderr: [] };
const child = spawn(electronPath, ['.'], {
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
await rm(root, { recursive: true, force: true });

const line = lines.stdout.find((entry) => entry.startsWith(RESULT_PREFIX));
if (!line) {
  console.error(lines.stderr.slice(-30).join('\n'));
  console.error(`smoke: no result, electron exit code ${code}`);
  process.exit(1);
}
const { versions, result } = JSON.parse(line.slice(RESULT_PREFIX.length));
console.log(
  `electron ${versions.electron}, node ${versions.node}, chrome ${versions.chrome}`,
);
for (const [name, scenario] of Object.entries(result.scenarios ?? {})) {
  console.log(`${scenario.ok ? 'PASS' : 'FAIL'} ${name}`);
  console.log(JSON.stringify(scenario));
}
if (result.error) console.log(`error: ${result.error}`);
for (const entry of lines.stderr) {
  if (entry.includes('sql runner started') || entry.includes('engine host')) {
    console.log(entry);
  }
}
if (!result.ok || code !== 0) {
  console.error(lines.stderr.slice(-30).join('\n'));
}
console.log(
  `smoke ${result.ok && code === 0 ? 'passed' : 'FAILED'} (exit ${code})`,
);
process.exit(result.ok && code === 0 ? 0 : 1);
