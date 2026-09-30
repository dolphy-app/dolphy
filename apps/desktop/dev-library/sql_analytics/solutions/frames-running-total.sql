SELECT name, salary, sum(salary) OVER (ORDER BY salary, name) AS run
FROM emp
WHERE salary IS NOT NULL;
