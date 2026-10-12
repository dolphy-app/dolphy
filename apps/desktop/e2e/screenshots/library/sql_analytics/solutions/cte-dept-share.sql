WITH pay AS (
  SELECT dept_id, sum(salary) AS s
  FROM emp
  WHERE dept_id IS NOT NULL
  GROUP BY dept_id
)
SELECT d.name AS dept, round(pay.s * 100.0 / (SELECT sum(s) FROM pay), 1) AS share
FROM pay
JOIN dept d ON d.id = pay.dept_id;
