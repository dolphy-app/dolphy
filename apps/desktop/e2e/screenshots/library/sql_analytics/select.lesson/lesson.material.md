# SELECT and expressions

`SELECT` picks columns and computes expressions for every row of the table in `FROM`.

```sql
SELECT name, salary * 12 AS yearly FROM emp;
```

- Name an expression with `AS`; the checker compares that name with the reference (case-insensitive).
- String concatenation is `||`; `+` only adds numbers.
- Dividing two integers in SQLite is integer division: `7 / 2` = 3. To get a fraction, make one operand real: `7 * 1.0 / 2`.
- Any arithmetic involving `NULL` yields `NULL`.
- `DISTINCT` removes duplicate result rows as a whole.
