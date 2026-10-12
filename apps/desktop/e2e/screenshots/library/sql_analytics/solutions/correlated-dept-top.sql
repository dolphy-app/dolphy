SELECT name, salary FROM emp e
WHERE salary = (SELECT max(salary) FROM emp WHERE dept_id = e.dept_id);
