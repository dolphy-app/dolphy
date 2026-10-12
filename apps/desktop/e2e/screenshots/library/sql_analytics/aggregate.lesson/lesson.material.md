# Aggregate functions

An aggregate collapses a set of rows into a single value.

- `count(*)` counts rows, `count(x)` counts rows where `x` is **not** `NULL`, and `count(DISTINCT x)` counts distinct known values.
- `sum`, `avg`, `min`, and `max` **skip** `NULL`. That is why `avg(x)` ≠ `sum(x) / count(*)`; to treat unknown values as zero, write `avg(coalesce(x, 0))`.
- When no rows match, `count` returns 0, while `sum`, `avg`, `min`, and `max` return `NULL` (`total(x)` returns 0.0).
- You can't use an aggregate in `WHERE`: rows are filtered first, and aggregates are computed afterwards.
