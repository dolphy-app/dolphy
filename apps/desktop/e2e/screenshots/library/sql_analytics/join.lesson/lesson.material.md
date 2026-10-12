# Inner joins

`JOIN ... ON` combines rows from two tables by a condition. An inner join keeps only the pairs for which the condition is true.

```sql
SELECT e.name, d.name AS dept
FROM emp e
JOIN dept d ON d.id = e.dept_id;
```

- Give tables aliases (`emp e`) and qualify columns (`e.name`): both tables have a `name` column.
- A row with `NULL` in the join key matches nothing and drops out of an inner join.
- Without `ON` you get a Cartesian product: every row paired with every other row.
- Joins can be chained: `a JOIN b ON ... JOIN c ON ...`.
- In a one-to-many relationship, the row on the "one" side repeats once per related row; `DISTINCT` removes unwanted duplicates.
