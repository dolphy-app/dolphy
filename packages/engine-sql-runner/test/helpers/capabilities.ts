/**
 * Пробы возможностей для `it.skipIf`: профиль выбирается по факту наличия
 * механизма (`setAuthorizer`, `db.limits`), а не по номеру версии Node
 * (engine-ts-testing.md: `skip` без пробы — ошибка ревью).
 */
import { probeCapabilities, profileOf } from '../../src/drivers.ts';
import { openSandbox } from '../../src/sandbox.ts';
import type { DriverId, HardeningOptions } from '../../src/types.ts';

export const capabilities = probeCapabilities();

/** Профиль `full` доступен: `node:sqlite` с authorizer и limits. */
export const HAS_FULL_PROFILE =
  profileOf('node-sqlite', capabilities) === 'full';

export const HAS_BETTER_SQLITE3 = capabilities.betterSqlite3;

/** Драйверы, которые есть в этом рантайме. */
export const AVAILABLE_DRIVERS: DriverId[] = [
  ...(capabilities.nodeSqlite.available ? (['node-sqlite'] as const) : []),
  ...(capabilities.betterSqlite3 ? (['better-sqlite3'] as const) : []),
];

export const NO_HARDENING: HardeningOptions = {
  queryOnly: false,
  authorizer: false,
  defensive: false,
  lengthLimit: null,
  sqlLengthLimit: null,
  readonlyHandle: false,
  prefilter: false,
};

/** Функция есть в сборке SQLite этого драйвера (`median`, `percentile` — SQLite ≥ 3.53). */
export const driverHasFunction = (driver: DriverId, name: string): boolean => {
  const sandbox = openSandbox(driver, '', NO_HARDENING);
  try {
    const statement = sandbox.prepare(
      `SELECT count(*) FROM pragma_function_list WHERE name = '${name}'`,
    );
    const [row] = [...statement.iterate()];
    return row?.[0] !== 0n;
  } finally {
    sandbox.close();
  }
};
