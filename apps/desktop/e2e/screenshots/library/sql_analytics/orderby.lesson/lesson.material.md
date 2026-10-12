# ORDER BY and LIMIT

Without `ORDER BY`, row order is not guaranteed. In this lesson's exercises, row order is checked.

- `ORDER BY a DESC, b` sorts by `a` descending first, then by `b` on ties. Finish with a unique or tie-breaking key.
- In SQLite, `NULL` sorts **lower** than any value: first with `ASC`, last with `DESC`. To be explicit, use `NULLS FIRST` / `NULLS LAST` or an `x IS NULL` sort key.
- `LIMIT n OFFSET k` takes `n` rows after skipping `k`; page `p` of size `n` is `OFFSET (p - 1) * n`.
- `ORDER BY` accepts column aliases and expressions.
