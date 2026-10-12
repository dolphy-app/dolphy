SELECT dept_id,
  sum(CASE WHEN bonus IS NOT NULL THEN 1 ELSE 0 END) AS with_bonus,
  sum(CASE WHEN bonus IS NULL THEN 1 ELSE 0 END) AS without_bonus
FROM emp
GROUP BY dept_id;
