SELECT name FROM dept WHERE id IN (SELECT dept_id FROM emp WHERE salary > 7000);
