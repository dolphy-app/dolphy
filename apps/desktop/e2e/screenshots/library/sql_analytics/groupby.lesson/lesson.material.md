# GROUP BY and HAVING

`GROUP BY` splits rows into groups by the values of its keys, and aggregates are computed separately for each group.

```sql
SELECT dept_id, count(*) AS n FROM emp GROUP BY dept_id;
```

- `NULL` in a key forms **its own group** — those rows don't disappear.
- `WHERE` filters rows **before** grouping; `HAVING` filters groups **after** aggregates are computed. A condition on an aggregate (`count(*) > 2`) is only possible in `HAVING`.
- The `SELECT` list may contain grouping keys and aggregates. SQLite silently accepts a "bare" column too, but takes its value from an arbitrary row in the group — don't write queries like that.
- You can group by several keys: `GROUP BY dept_id, title`.
