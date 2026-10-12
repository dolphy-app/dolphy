SELECT name, salary,
  round(salary - avg(salary) OVER (PARTITION BY dept_id)) AS diff
FROM emp
WHERE dept_id IS NOT NULL AND salary IS NOT NULL;
