SELECT dept_id, title, count(*) AS n, sum(salary) AS payroll
FROM emp
WHERE dept_id IS NOT NULL
GROUP BY dept_id, title;
