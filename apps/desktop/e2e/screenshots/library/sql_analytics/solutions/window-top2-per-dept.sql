WITH ranked AS (
  SELECT dept_id, name, salary,
    row_number() OVER (PARTITION BY dept_id ORDER BY salary DESC, name) AS rn
  FROM emp
  WHERE dept_id IS NOT NULL AND salary IS NOT NULL
)
SELECT dept_id, name, salary FROM ranked WHERE rn <= 2;
