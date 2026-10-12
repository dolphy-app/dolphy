SELECT name, dept_id,
  dense_rank() OVER (PARTITION BY dept_id ORDER BY salary DESC) AS place
FROM emp
WHERE dept_id IS NOT NULL AND salary IS NOT NULL;
