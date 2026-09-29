SELECT name FROM emp WHERE salary > (SELECT avg(salary) FROM emp);
