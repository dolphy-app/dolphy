# NULL and three-valued logic

`NULL` means "the value is unknown". Comparing with it yields neither true nor false but **UNKNOWN**; `WHERE` only lets true through.

- `x = NULL` and `x <> NULL` are always UNKNOWN. Test with `x IS NULL` and `x IS NOT NULL`.
- `NULL OR TRUE` = TRUE, `NULL AND FALSE` = FALSE, `NOT NULL` = NULL.
- `x NOT IN (1, 2)` with `x = NULL` is UNKNOWN: a row with an unknown value does **not** make it into the result.
- `COALESCE(a, b, ...)` returns the first non-`NULL` value; `NULLIF(a, b)` returns `NULL` when `a = b`.
- In SQLite, `IS NOT` compares like `<>` but treats `NULL` as an ordinary value: `salary IS NOT 6000` is also true for `NULL`.
