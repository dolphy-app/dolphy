SELECT id, min(salary * 11 / 10, 8000) AS new_salary FROM emp WHERE dept_id = 1;
