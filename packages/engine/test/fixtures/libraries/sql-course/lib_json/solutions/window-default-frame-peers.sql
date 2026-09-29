SELECT name, sum(salary) OVER (ORDER BY salary) AS run FROM emp WHERE salary IS NOT NULL;
