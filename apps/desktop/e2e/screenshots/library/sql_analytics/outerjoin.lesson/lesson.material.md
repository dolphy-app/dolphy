# LEFT JOIN and self-joins

`LEFT JOIN` keeps **all** rows of the left table; when there is no match on the right, the right-hand columns are filled with `NULL`.

- An **anti-join** finds rows without a match: `LEFT JOIN ... WHERE right.id IS NULL`.
- A condition on the right table in `WHERE` discards the `NULL` rows and turns a `LEFT JOIN` into a plain `JOIN`. A condition that should take part in the matching belongs in `ON`.
- A **self-join** joins a table to itself under two aliases: `emp e LEFT JOIN emp m ON m.id = e.mgr_id` ("employee — their manager"). You need `LEFT JOIN` here, or the root of the tree (the person with no manager) disappears.
- Pairs within one table: the condition `a.id < b.id` keeps each unordered pair once and removes pairs of a row with itself.
