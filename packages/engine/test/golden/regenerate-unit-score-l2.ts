/**
 * Перегенерация `unit-score-l2.jsonl` и его записи в `MANIFEST.json`.
 * Не тест (vitest его не подхватывает); запуск из `packages/engine`:
 *
 *   node --disable-warning=ExperimentalWarning test/golden/regenerate-unit-score-l2.ts
 *
 * Материализует библиотеки (`unit-score-l2-libraries.ts`), запускает
 * `cargo run --release --offline --bin unit_score_l2_golden` из `golden-rs`
 * (нужны Trane v0.34.1 в `golden-rs/trane-pristine` и офлайн-кэш cargo) и
 * записывает sha256 fixture в манифест. Повторный запуск даёт побайтово тот
 * же файл: состояния детерминированы, ГСЧ планировщика не участвует, а средние
 * по уроку и курсу, чей порядок суммирования у Trane зависит от процесса
 * (сид `ahash` в `ustr`), генератор приводит к средним в порядке id
 * (`canonical_means` в `unit_score_l2_golden.rs`).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { hashTree } from '../helpers/rust-dumps.ts';
import { L2_LIBRARIES } from './unit-score-l2-libraries.ts';

const FIXTURE = 'unit-score-l2.jsonl';
const BIN = 'unit_score_l2_golden';
const goldenDir = fileURLToPath(new URL('./', import.meta.url));
const output = process.env.L2_OUT ?? join(goldenDir, FIXTURE);

const main = async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'unit-score-l2-'));
  try {
    const libraries: string[] = [];
    for (const library of L2_LIBRARIES) {
      const root = await library.prepare(tmp);
      libraries.push(`${library.name},${root},${await hashTree(root)}`);
    }
    const run = spawnSync(
      'cargo',
      [
        'run',
        '--release',
        '--offline',
        '--bin',
        BIN,
        '--',
        output,
        ...libraries,
      ],
      { cwd: join(goldenDir, 'golden-rs'), stdio: 'inherit' },
    );
    if (run.status !== 0) throw new Error(`cargo run failed: ${run.status}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const bytes = readFileSync(output);
  const lines = bytes.toString('utf8').split('\n').filter(Boolean);
  const header = JSON.parse(lines[0] as string) as { seed: string };
  if (output !== join(goldenDir, FIXTURE)) return;

  const manifestPath = join(goldenDir, 'MANIFEST.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    fixtures: Record<string, unknown>;
  };
  manifest.fixtures[FIXTURE] = {
    bin: BIN,
    header: true,
    seed: header.seed,
    cases: lines.length - 1,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const config = (await prettier.resolveConfig(manifestPath)) ?? {};
  writeFileSync(
    manifestPath,
    await prettier.format(JSON.stringify(manifest), {
      ...config,
      parser: 'json',
      objectWrap: 'collapse',
    }),
  );
  console.log(`${FIXTURE}: ${lines.length - 1} cases`);
};

await main();
