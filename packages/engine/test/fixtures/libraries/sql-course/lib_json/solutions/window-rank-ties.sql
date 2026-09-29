SELECT name, rank() OVER (ORDER BY salary DESC) AS r, dense_rank() OVER (ORDER BY salary DESC) AS d FROM emp WHERE salary IS NOT NULL;
