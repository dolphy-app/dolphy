SELECT name, salary FROM emp WHERE salary > (SELECT avg(salary) FROM emp);
