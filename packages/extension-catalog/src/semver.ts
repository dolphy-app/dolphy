import { CatalogFormatError } from './errors.ts';

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly string[];
}

const NUMERIC = '(0|[1-9]\\d*)';
const SEMVER = new RegExp(
  `^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}(?:-([0-9A-Za-z.-]+))?$`,
);
const NUMERIC_ID = /^\d+$/;

export const parseSemver = (text: string): Semver | null => {
  const match = SEMVER.exec(text);
  if (match === null) return null;
  const [, major = '', minor = '', patch = '', pre] = match;
  const prerelease = pre === undefined ? [] : pre.split('.');
  const invalid = prerelease.some(
    (id) => id === '' || (NUMERIC_ID.test(id) && /^0\d/.test(id)),
  );
  if (invalid) return null;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease,
  };
};

export const isSemver = (text: string): boolean => parseSemver(text) !== null;

type Order = -1 | 0 | 1;

const sign = (difference: number): Order => {
  if (difference < 0) return -1;
  return difference > 0 ? 1 : 0;
};

const compareIdentifier = (a: string, b: string): Order => {
  const aNumeric = NUMERIC_ID.test(a);
  const bNumeric = NUMERIC_ID.test(b);
  if (aNumeric && bNumeric) return sign(Number(a) - Number(b));
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

const comparePrerelease = (
  a: readonly string[],
  b: readonly string[],
): Order => {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const common = Math.min(a.length, b.length);
  for (let i = 0; i < common; i++) {
    const order = compareIdentifier(a[i] ?? '', b[i] ?? '');
    if (order !== 0) return order;
  }
  return sign(a.length - b.length);
};

const compareParsed = (a: Semver, b: Semver): Order =>
  sign(a.major - b.major) ||
  sign(a.minor - b.minor) ||
  sign(a.patch - b.patch) ||
  comparePrerelease(a.prerelease, b.prerelease);

const mustParse = (text: string): Semver => {
  const parsed = parseSemver(text);
  if (parsed === null)
    throw new CatalogFormatError([`invalid semver '${text}'`]);
  return parsed;
};

export const compareSemver = (a: string, b: string): Order =>
  compareParsed(mustParse(a), mustParse(b));

type Operator = '<' | '<=' | '>=' | '>' | '=';

interface Comparator {
  operator: Operator;
  version: Semver;
}

const COMPARATOR = /^(<=|>=|<|>|=)?(.+)$/;

const satisfies: Record<Operator, (order: Order) => boolean> = {
  '<': (order) => order < 0,
  '<=': (order) => order <= 0,
  '>=': (order) => order >= 0,
  '>': (order) => order > 0,
  '=': (order) => order === 0,
};

const parseComparator = (token: string, range: string): Comparator => {
  const match = COMPARATOR.exec(token);
  const version = match?.[2] === undefined ? null : parseSemver(match[2]);
  if (match === null || version === null) {
    throw new CatalogFormatError([`invalid version range '${range}'`]);
  }
  return { operator: (match[1] ?? '=') as Operator, version };
};

export const parseRange = (range: string): readonly Comparator[] => {
  const tokens = range.split(' ').filter((token) => token !== '');
  if (tokens.length === 0 || range.trim() !== range) {
    throw new CatalogFormatError([`invalid version range '${range}'`]);
  }
  return tokens.map((token) => parseComparator(token, range));
};

export const satisfiesRange = (version: string, range: string): boolean => {
  const comparators = parseRange(range);
  const parsed = mustParse(version);
  return comparators.every(({ operator, version: bound }) =>
    satisfies[operator](compareParsed(parsed, bound)),
  );
};
