# Joins with aggregates

A "per X" report is usually built like this: join the tables, then group.

- To keep "empty" Xs in the report (a department with no employees), `LEFT JOIN` from the X table and use `count(right.id)`: `count(*)` would also count the `NULL` placeholder row and return 1 instead of 0.
- **Row fan-out.** In a "customer → orders → line items" chain, each order row repeats once per line item. So count orders with `count(DISTINCT o.id)`, and total the line items with `sum(qty * price)`.
- `sum` over an empty group returns `NULL`; for "zero instead of unknown", use `coalesce(sum(x), 0)`.
- After a join, conditions on aggregates go in `HAVING`, and conditions on the source rows go in `WHERE`.
