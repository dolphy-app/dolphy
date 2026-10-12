SELECT name, dept_id,
  last_value(name) OVER (
    PARTITION BY dept_id ORDER BY hired
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
  ) AS newest
FROM emp
WHERE dept_id IS NOT NULL;
