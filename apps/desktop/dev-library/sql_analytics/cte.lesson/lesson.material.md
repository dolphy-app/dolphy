# CTE: WITH и рекурсия

`WITH имя AS (запрос)` даёт запросу имя, на которое можно ссылаться в основном запросе несколько раз.

```sql
WITH dept_pay AS (
  SELECT dept_id, sum(salary) AS pay FROM emp GROUP BY dept_id
)
SELECT dept_id FROM dept_pay WHERE pay > (SELECT avg(pay) FROM dept_pay);
```

- CTE читается сверху вниз как последовательность шагов; один и тот же подзапрос не приходится писать дважды. Можно объявить несколько CTE через запятую, а следующие могут использовать предыдущие.
- **Рекурсивный CTE** (`WITH RECURSIVE`) состоит из якоря, `UNION ALL` и рекурсивной части, которая обращается к самому CTE. Так обходят деревья — например, все подчинённые руководителя на любой глубине:

```sql
WITH RECURSIVE tree(id, depth) AS (
  SELECT id, 0 FROM emp WHERE id = 1
  UNION ALL
  SELECT e.id, tree.depth + 1 FROM emp e JOIN tree ON e.mgr_id = tree.id
)
SELECT * FROM tree;
```

- Запрос с `WITH` по-прежнему один оператор `SELECT`.
