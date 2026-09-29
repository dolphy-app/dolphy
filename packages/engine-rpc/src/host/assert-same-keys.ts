/** Fail-fast: наборы ключей таблицы методов и схем должны совпадать. */
export const assertSameKeys = (
  expected: readonly string[],
  actual: readonly string[],
): void => {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((key) => !actualSet.has(key));
  const extra = actual.filter((key) => !expectedSet.has(key));
  if (missing.length === 0 && extra.length === 0) return;
  throw new Error(
    `RPC schemas mismatch: missing [${missing.join(', ')}], extra [${extra.join(', ')}]`,
  );
};
