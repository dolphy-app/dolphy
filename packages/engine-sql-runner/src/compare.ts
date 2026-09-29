import type {
  Cell,
  CompareOptions,
  Expected,
  ResultSet,
  Row,
} from './types.ts';

interface CsvField {
  value: string;
  quoted: boolean;
}

const INTEGER_RE = /^[+-]?\d+$/u;
const DECIMAL_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/u;

/**
 * Диалект ожидаемого CSV (подмножество RFC 4180): первая запись — заголовок.
 * Пустое поле без кавычек — NULL, `""` — пустая строка, поле в кавычках —
 * всегда TEXT, целое без кавычек — INTEGER, десятичное/экспонента — REAL,
 * прочее — TEXT. `\r\n` и `\n` допустимы.
 */
export const parseCsv = (csv: string): ResultSet => {
  const records: CsvField[][] = [];
  let record: CsvField[] = [];
  let field = '';
  let quoted = false;
  let inQuotes = false;
  let pending = false;
  const endField = () => {
    record.push({ value: field, quoted });
    field = '';
    quoted = false;
    pending = true;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
    pending = false;
  };
  const n = csv.length;
  let i = 0;
  while (i < n) {
    const c = csv.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (csv.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '' && !quoted) {
      inQuotes = true;
      quoted = true;
      i++;
    } else if (c === ',') {
      endField();
      i++;
    } else if (c === '\r' && csv.charAt(i + 1) === '\n') {
      endRecord();
      i += 2;
    } else if (c === '\n') {
      endRecord();
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (inQuotes) throw new Error('CSV: unterminated quoted field');
  if (pending || field !== '' || quoted) endRecord();
  const [header, ...body] = records;
  if (header === undefined) throw new Error('CSV: no header');
  const columns = header.map(({ value }) => value);
  const rows = body.map((fields, index): Row => {
    if (fields.length !== columns.length) {
      throw new Error(
        `CSV: record ${index + 2} has ${fields.length} fields, header has ${columns.length}`,
      );
    }
    return fields.map(({ value, quoted: isQuoted }): Cell => {
      if (isQuoted) return value;
      if (value === '') return null;
      if (INTEGER_RE.test(value)) return BigInt(value);
      if (DECIMAL_RE.test(value)) return Number(value);
      return value;
    });
  });
  return { columns, rows };
};

export const expectedToResultSet = (expected: Expected): ResultSet => {
  if ('csv' in expected) return parseCsv(expected.csv);
  const width = expected.rows[0]?.length ?? expected.columns?.length ?? 0;
  return {
    columns:
      expected.columns ?? Array.from({ length: width }, (_, i) => `c${i}`),
    rows: expected.rows,
  };
};

const isNumber = (cell: Cell): cell is bigint | number =>
  typeof cell === 'bigint' || typeof cell === 'number';

const hex = (bytes: Uint8Array): string => {
  const digits: string[] = [];
  for (const byte of bytes) digits.push(byte.toString(16).padStart(2, '0'));
  return digits.join('');
};

/** Равенство ячеек: `1 == 1.0`, `NULL == NULL`, `TEXT '1' ≠ INTEGER 1`, `bigint` — точно. */
export const cellEquals = (a: Cell, b: Cell, tolerance: number): boolean => {
  if (a === null || b === null) return a === b;
  if (isNumber(a) && isNumber(b)) {
    if (typeof a === 'bigint' && typeof b === 'bigint') return a === b;
    const x = Number(a);
    const y = Number(b);
    if (x === y) return true;
    if (tolerance === 0) return false;
    return Math.abs(x - y) <= tolerance * Math.max(1, Math.abs(x), Math.abs(y));
  }
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return hex(a) === hex(b);
  }
  return false;
};

/** Ключ сортировки для мультимножества: NULL < число < текст < blob. */
const cellKey = (cell: Cell, tolerance: number): string => {
  if (cell === null) return '0';
  if (isNumber(cell)) {
    const x = Number(cell);
    if (!Number.isFinite(x)) return `1${x > 0 ? 'z' : 'a'}`;
    if (tolerance === 0) return `1${x.toExponential(17)}`;
    // почти равные числа — под одним ключом; краевые случаи ловит жадное сопоставление
    if (Math.abs(x) < 1) return `1a${Math.round(x / tolerance)}`;
    const digits = Math.max(1, Math.floor(-Math.log10(tolerance)));
    return `1r${x.toPrecision(digits)}`;
  }
  if (typeof cell === 'string') return `2${cell}`;
  return `3${hex(cell)}`;
};

const rowKey = (row: Row, tolerance: number): string =>
  row.map((cell) => cellKey(cell, tolerance)).join('\u0001');

const rowEquals = (a: Row, b: Row, tolerance: number): boolean =>
  a.length === b.length &&
  a.every((cell, i) => cellEquals(cell, b[i] as Cell, tolerance));

const format = (cell: Cell): string => {
  if (cell === null) return 'NULL';
  if (typeof cell === 'bigint') return `${cell}`;
  if (typeof cell === 'string') return JSON.stringify(cell);
  if (typeof cell === 'number') {
    return Number.isInteger(cell) ? `${cell}.0` : `${cell}`;
  }
  return `x'${hex(cell)}'`;
};

const formatRow = (row: Row): string => `(${row.map(format).join(', ')})`;

export interface CompareOutcome {
  equal: boolean;
  /** Наш текст без ожидаемых значений. */
  reason: string;
  /** Ожидаемые значения: показывать только в режиме автора. */
  detail: string;
}

const EQUAL: CompareOutcome = { equal: true, reason: 'ok', detail: '' };

const columnSignature = (rows: Row[], index: number, tolerance: number) =>
  rows
    .map((row) => cellKey(row[index] as Cell, tolerance))
    .sort()
    .join('\u0002');

const compareStrings = (a: string, b: string) => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

const lower = (text: string) => text.toLowerCase();

/** Перестановка `perm[j]` = индекс столбца результата для ожидаемого столбца `j`. */
const permute = (
  actual: ResultSet,
  expected: ResultSet,
  options: { ignoreNames: boolean; anyOrder: boolean; tolerance: number },
): number[] | CompareOutcome => {
  const { ignoreNames, anyOrder, tolerance } = options;
  const width = expected.columns.length;
  const identity = Array.from({ length: width }, (_, i) => i);
  const fail = (reason: string, detail = ''): CompareOutcome => ({
    equal: false,
    reason,
    detail,
  });
  const listing = `expected columns [${expected.columns.join(', ')}], got [${actual.columns.join(', ')}]`;
  if (anyOrder) {
    const used = new Set<number>();
    const perm: number[] = [];
    if (!ignoreNames) {
      for (const name of expected.columns) {
        const index = actual.columns.findIndex(
          (column, k) => !used.has(k) && lower(column) === lower(name),
        );
        if (index < 0)
          return fail(`missing column ${JSON.stringify(name)}`, listing);
        used.add(index);
        perm.push(index);
      }
      return perm;
    }
    const signatures = actual.columns.map((_, k) =>
      columnSignature(actual.rows, k, tolerance),
    );
    for (let j = 0; j < width; j++) {
      const wanted = columnSignature(expected.rows, j, tolerance);
      const index = signatures.findIndex(
        (s, k) => !used.has(k) && s === wanted,
      );
      if (index < 0) {
        return fail(
          `no result column matches the values of expected column ${j + 1}`,
        );
      }
      used.add(index);
      perm.push(index);
    }
    return perm;
  }
  if (!ignoreNames) {
    for (let j = 0; j < width; j++) {
      const got = actual.columns[j] as string;
      const want = expected.columns[j] as string;
      if (lower(got) !== lower(want)) {
        return fail(
          `column ${j + 1} is named ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`,
        );
      }
    }
  }
  return identity;
};

export const compareResults = (
  actual: ResultSet,
  expected: ResultSet,
  options: CompareOptions = {},
): CompareOutcome => {
  const tolerance = options.numericTolerance ?? 1e-9;
  const ordered = options.orderSensitive ?? false;
  const fail = (reason: string, detail = ''): CompareOutcome => ({
    equal: false,
    reason,
    detail,
  });
  if (actual.columns.length !== expected.columns.length) {
    return fail(
      `expected ${expected.columns.length} column(s), got ${actual.columns.length}`,
      `expected columns [${expected.columns.join(', ')}], got [${actual.columns.join(', ')}]`,
    );
  }
  const perm = permute(actual, expected, {
    ignoreNames: options.ignoreColumnNames ?? false,
    anyOrder: options.columnOrder === 'any',
    tolerance,
  });
  if (!Array.isArray(perm)) return perm as CompareOutcome;
  const aligned = perm.every((p, i) => p === i)
    ? actual.rows
    : actual.rows.map((row) => perm.map((p) => row[p] as Cell));
  const wanted = expected.rows;
  if (aligned.length !== wanted.length) {
    return fail(`expected ${wanted.length} row(s), got ${aligned.length}`);
  }
  if (ordered) {
    for (let i = 0; i < wanted.length; i++) {
      const got = aligned[i] as Row;
      const want = wanted[i] as Row;
      if (!rowEquals(got, want, tolerance)) {
        return fail(
          `row ${i + 1} differs`,
          `row ${i + 1}: got ${formatRow(got)}, expected ${formatRow(want)}`,
        );
      }
    }
    return EQUAL;
  }
  const byKey = (a: Row, b: Row) =>
    compareStrings(rowKey(a, tolerance), rowKey(b, tolerance));
  const sortedActual = [...aligned].sort(byKey);
  const sortedWanted = [...wanted].sort(byKey);
  const bad = sortedWanted.findIndex(
    (row, i) => !rowEquals(sortedActual[i] as Row, row, tolerance),
  );
  if (bad < 0) return EQUAL;
  // краевые случаи сетки допуска: жадное сопоставление O(n²)
  if (tolerance > 0 && sortedWanted.length <= 2000) {
    const rest = [...sortedActual];
    const matched = sortedWanted.every((row) => {
      const k = rest.findIndex((candidate) =>
        rowEquals(candidate, row, tolerance),
      );
      if (k < 0) return false;
      rest.splice(k, 1);
      return true;
    });
    if (matched) return EQUAL;
  }
  return fail(
    'result rows differ from the expected rows',
    `sorted row ${bad + 1}: got ${formatRow(sortedActual[bad] as Row)}, expected ${formatRow(sortedWanted[bad] as Row)}`,
  );
};
