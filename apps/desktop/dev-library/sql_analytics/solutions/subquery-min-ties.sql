SELECT name, salary FROM emp WHERE salary = (SELECT min(salary) FROM emp);
