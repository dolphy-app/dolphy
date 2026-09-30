SELECT name,
  rank() OVER (ORDER BY salary DESC) AS rk,
  dense_rank() OVER (ORDER BY salary DESC) AS dr
FROM emp
WHERE salary IS NOT NULL;
