SELECT name FROM emp e
WHERE salary > (SELECT avg(salary) FROM emp WHERE dept_id = e.dept_id);
