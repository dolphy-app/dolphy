/**
 * Перегенерация `test/fixtures/rust-dumps/*.json` и `MANIFEST.json`.
 * Не тест (vitest его не подхватывает); запуск из `packages/engine`:
 *
 *   node --disable-warning=ExperimentalWarning test/helpers/regenerate-rust-dumps.ts
 *
 * Нужен бинарь `dump-rs` (исходник `spike/loader-bench/dump-rs`, зависимость
 * `trane` — `reference/trane-pristine`, v0.34.1): переменные окружения
 * `DUMP_RS` (бинарь), `DUMP_RS_SOURCE` (main.rs), `TRANE_PRISTINE` (каталог
 * Trane). Дамп крупнее `MAX_COMMITTED_BYTES` не сохраняется: в манифесте
 * остаются sha256 и команда.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RELATION_SECTIONS } from './graph-dump.ts';
import {
  DUMP_CASES,
  RUST_DUMPS_DIR,
  RUST_DUMPS_MANIFEST,
  hashTree,
  sha256,
} from './rust-dumps.ts';
import type { DumpManifest, DumpManifestEntry } from './rust-dumps.ts';

const run = promisify(execFile);

const MAX_COMMITTED_BYTES = 1_000_000;
const REFERENCE = '/Users/tinkerbells/projects/lms-platform/engine-ts';
const dumper =
  process.env.DUMP_RS ?? '/tmp/dump-rs-build/target/release/dump-rs';
const dumperSource =
  process.env.DUMP_RS_SOURCE ??
  `${REFERENCE}/spike/loader-bench/dump-rs/src/main.rs`;
const tranePristine =
  process.env.TRANE_PRISTINE ?? `${REFERENCE}/reference/trane-pristine`;

const traneVersion = async () => {
  const cargo = await readFile(join(tranePristine, 'Cargo.toml'), 'utf8');
  return /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1] ?? 'unknown';
};

/** Скелет: отношения только между курсами Rust (id курсов — в `courseIds`). */
const toSkeleton = (dump: Record<string, unknown>) => {
  const units = dump.units as Record<string, string>;
  const courseIds = Object.keys(units)
    .filter((id) => units[id] === 'Course')
    .sort();
  const courses = new Set(courseIds);
  const skeleton: Record<string, unknown> = { courseIds };
  for (const name of RELATION_SECTIONS) {
    const source = (dump[name] ?? {}) as Record<string, unknown[]>;
    const result: Record<string, unknown[]> = {};
    for (const [key, items] of Object.entries(source)) {
      if (!courses.has(key)) continue;
      const kept = items.filter((item) =>
        courses.has(Array.isArray(item) ? String(item[0]) : String(item)),
      );
      if (kept.length > 0) result[key] = kept;
    }
    skeleton[name] = result;
  }
  skeleton.counts = dump.counts;
  return skeleton;
};

const main = async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rust-dumps-'));
  const manifest: DumpManifest = {
    dumper: {
      source: 'spike/loader-bench/dump-rs/src/main.rs',
      sourceSha256: sha256(await readFile(dumperSource)),
      trane: await traneVersion(),
      note: 'LocalCourseLibrary::new + UnitGraph; open_ms из дампа удалён (недетерминирован)',
    },
    maxCommittedBytes: MAX_COMMITTED_BYTES,
    dumps: {},
  };
  try {
    for (const dumpCase of DUMP_CASES) {
      const { root, prefs } = await dumpCase.prepare(tmp);
      const libraryTreeSha256 = await hashTree(root);
      const out = join(tmp, `${dumpCase.name}.rust.json`);
      const args = [root, ...(prefs ? ['--prefs', prefs] : []), '--out', out];
      await run(dumper, args);
      const dump = JSON.parse(await readFile(out, 'utf8')) as Record<
        string,
        unknown
      >;
      const rest = { ...dump };
      delete rest.open_ms;
      const stored =
        dumpCase.scope === 'course-skeleton' ? toSkeleton(rest) : rest;
      const text = JSON.stringify(stored);
      const bytes = Buffer.byteLength(text);
      const committed = bytes <= MAX_COMMITTED_BYTES;
      const file = `${dumpCase.name}.json`;
      if (committed) await writeFile(join(RUST_DUMPS_DIR, file), text);
      const entry: DumpManifestEntry = {
        file: committed ? file : null,
        sha256: sha256(text),
        bytes,
        libraryTreeSha256,
        scope: dumpCase.scope,
        ignoredPaths: dumpCase.ignoredPaths,
        prefs: prefs !== undefined,
        params: dumpCase.params ?? null,
        counts: rest.counts as DumpManifestEntry['counts'],
        command: `dump-rs <${dumpCase.name}> ${prefs ? '--prefs user_preferences.json ' : ''}--out dump.json`,
      };
      manifest.dumps[dumpCase.name] = entry;
      console.log(
        `${dumpCase.name}: ${bytes} bytes${committed ? '' : ' (not committed)'}`,
      );
    }
    await writeFile(
      RUST_DUMPS_MANIFEST,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
};

await main();
