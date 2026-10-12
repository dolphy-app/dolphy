SELECT name,
  CASE
    WHEN salary IS NULL THEN 'n/a'
    WHEN salary >= 7000 THEN 'high'
    WHEN salary >= 5000 THEN 'mid'
    ELSE 'low'
  END AS grade
FROM emp;
