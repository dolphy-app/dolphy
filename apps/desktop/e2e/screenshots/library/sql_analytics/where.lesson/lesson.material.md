# Filtering with WHERE

`WHERE` keeps only the rows for which the condition is **true**.

- Comparison operators: `=`, `<>`, `<`, `<=`, `>`, `>=`; `BETWEEN a AND b` includes both bounds; `IN (...)` matches a list of values.
- Precedence: `NOT`, then `AND`, then `OR`. When mixing `AND` and `OR`, use parentheses: `a OR b AND c` means `a OR (b AND c)`.
- De Morgan's law: `NOT (a OR b)` = `NOT a AND NOT b`. Writing "not A or not B" by mistake almost always lets every row through.
- `LIKE`: `%` matches any substring, `_` matches one character. In SQLite, `LIKE` ignores the case of ASCII letters, while `GLOB` is case-sensitive.
