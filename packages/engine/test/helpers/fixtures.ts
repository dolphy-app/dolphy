import { fileURLToPath } from 'node:url';

export const FIXTURES_DIR = fileURLToPath(
  new URL('../fixtures/', import.meta.url),
).replace(/\/$/, '');

export const LIBRARIES_DIR = `${FIXTURES_DIR}/libraries`;

/** Библиотеки Trane v0.34.1 (`tests/*_test_library`, без `.trane`). */
export const TRANE_LIBRARIES = {
  embedded: `${LIBRARIES_DIR}/trane-embedded`,
  small: `${LIBRARIES_DIR}/trane-small`,
  large: `${LIBRARIES_DIR}/trane-large`,
} as const;
