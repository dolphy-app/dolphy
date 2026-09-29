SELECT name, row_number() OVER (PARTITION BY dept_id ORDER BY salary DESC, name) AS rn FROM emp WHERE dept_id IS NOT NULL;
